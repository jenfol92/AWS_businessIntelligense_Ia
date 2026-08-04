$ErrorActionPreference = "Stop"

$container = "supabase_db_ERP_BACKUP"
$database = "postgres"
$lineId = "59000000-0000-4000-8000-000000000001"
$keyA = "legacy-concurrency-59000000-a"
$keyB = "legacy-concurrency-59000000-b"
$runId = [Guid]::NewGuid().ToString("N")
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "credit-line-legacy-$runId"
$containerRoot = "/tmp/credit-line-legacy-$runId"

function Invoke-LocalPsqlFile([string]$hostPath, [string]$containerPath) {
  & docker cp $hostPath "${container}:${containerPath}"
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed for $hostPath" }
  & docker exec $container psql -U postgres -d $database -v ON_ERROR_STOP=1 -f $containerPath
  if ($LASTEXITCODE -ne 0) { throw "psql failed for $containerPath" }
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  [IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))
}

New-Item -ItemType Directory -Path $tempRoot | Out-Null
$setupPath = Join-Path $tempRoot "setup.sql"
$workerAPath = Join-Path $tempRoot "worker-a.sql"
$workerBPath = Join-Path $tempRoot "worker-b.sql"
$verifyPath = Join-Path $tempRoot "verify.sql"
$cleanupPath = Join-Path $tempRoot "cleanup.sql"
$outputA = Join-Path $tempRoot "worker-a.out"
$outputB = Join-Path $tempRoot "worker-b.out"
$verifyOutput = Join-Path $tempRoot "verify.out"

$payload = '[{"principalEur":100,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]'

try {
  Write-Utf8NoBom $setupPath @"
INSERT INTO public.finance_credit_lines(
  id,bank_name,line_name,credit_limit,available_amount,used_amount,cycle_days,repayment_mode,status)
VALUES('$lineId','TEST','LEGACY CONCURRENCY',1000,900,100,90,'periodic_release','active');
"@
  Invoke-LocalPsqlFile $setupPath "$containerRoot-setup.sql"

  $workerTemplate = @'
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT public.finance_register_legacy_opening_balance_v2(
  '__LINE_ID__','__PAYLOAD__'::jsonb,'__KEY__');
'@
  Write-Utf8NoBom $workerAPath ($workerTemplate.Replace('__LINE_ID__',$lineId).Replace('__PAYLOAD__',$payload).Replace('__KEY__',$keyA))
  Write-Utf8NoBom $workerBPath ($workerTemplate.Replace('__LINE_ID__',$lineId).Replace('__PAYLOAD__',$payload).Replace('__KEY__',$keyB))
  & docker cp $workerAPath "${container}:${containerRoot}-a.sql"
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed for worker A" }
  & docker cp $workerBPath "${container}:${containerRoot}-b.sql"
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed for worker B" }

  $processA = Start-Process docker -ArgumentList @("exec",$container,"psql","-U","postgres","-d",$database,"-v","ON_ERROR_STOP=1","-f","$containerRoot-a.sql") -NoNewWindow -PassThru -RedirectStandardOutput $outputA -RedirectStandardError "$outputA.err"
  $processB = Start-Process docker -ArgumentList @("exec",$container,"psql","-U","postgres","-d",$database,"-v","ON_ERROR_STOP=1","-f","$containerRoot-b.sql") -NoNewWindow -PassThru -RedirectStandardOutput $outputB -RedirectStandardError "$outputB.err"
  Wait-Process -Id $processA.Id,$processB.Id
  $processA.Refresh(); $processB.Refresh()
  $combinedA = (Get-Content -Raw -LiteralPath $outputA) + (Get-Content -Raw -LiteralPath "$outputA.err")
  $combinedB = (Get-Content -Raw -LiteralPath $outputB) + (Get-Content -Raw -LiteralPath "$outputB.err")
  $successCount = @($combinedA,$combinedB).Where({ $_ -match '"regularization_id"' }).Count
  $noGapCount = @($combinedA,$combinedB).Where({ $_ -match 'NO_LEGACY_GAP' }).Count
  if ($successCount -ne 1 -or $noGapCount -ne 1) {
    throw "Expected exactly one success and one NO_LEGACY_GAP; success=$successCount noGap=$noGapCount"
  }

  Write-Utf8NoBom $verifyPath @"
SELECT json_build_object(
  'regularizations',(SELECT count(*) FROM public.finance_credit_line_legacy_regularizations WHERE credit_line_id='$lineId'),
  'groups',(SELECT count(*) FROM public.finance_credit_line_repayment_groups WHERE credit_line_id='$lineId' AND group_origin_type='legacy_regularization'),
  'items',(SELECT count(*) FROM public.finance_credit_line_legacy_regularization_items WHERE credit_line_id='$lineId'),
  'movements',(SELECT count(*) FROM public.finance_credit_line_movements WHERE credit_line_id='$lineId' AND source_type='legacy_opening_balance')
);
"@
  & docker cp $verifyPath "${container}:${containerRoot}-verify.sql"
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed for verification" }
  & docker exec $container psql -U postgres -d $database -v ON_ERROR_STOP=1 -At -f "$containerRoot-verify.sql" 2>&1 | Set-Content -LiteralPath $verifyOutput
  if ($LASTEXITCODE -ne 0) { throw "verification query failed" }
  $counts = Get-Content -Raw -LiteralPath $verifyOutput
  if ($counts -notmatch '"regularizations"\s*:\s*1' -or $counts -notmatch '"groups"\s*:\s*1' -or $counts -notmatch '"items"\s*:\s*1' -or $counts -notmatch '"movements"\s*:\s*1') {
    throw "Unexpected concurrency counts: $counts"
  }
  Write-Output "credit-line legacy concurrency: OK"
}
finally {
  Write-Utf8NoBom $cleanupPath @"
BEGIN;
SET LOCAL session_replication_role=replica;
DELETE FROM public.finance_credit_line_legacy_regularization_items WHERE credit_line_id='$lineId';
DELETE FROM public.finance_credit_line_movements WHERE credit_line_id='$lineId';
DELETE FROM public.finance_credit_line_repayment_groups WHERE credit_line_id='$lineId';
DELETE FROM public.finance_credit_line_legacy_regularizations WHERE credit_line_id='$lineId' AND idempotency_key IN ('$keyA','$keyB');
DELETE FROM public.finance_credit_lines WHERE id='$lineId';
COMMIT;
DO `$`$
BEGIN
  IF EXISTS(SELECT 1 FROM public.finance_credit_lines WHERE id='$lineId')
     OR EXISTS(SELECT 1 FROM public.finance_credit_line_legacy_regularizations WHERE credit_line_id='$lineId')
     OR EXISTS(SELECT 1 FROM public.finance_credit_line_repayment_groups WHERE credit_line_id='$lineId')
     OR EXISTS(SELECT 1 FROM public.finance_credit_line_legacy_regularization_items WHERE credit_line_id='$lineId')
     OR EXISTS(SELECT 1 FROM public.finance_credit_line_movements WHERE credit_line_id='$lineId') THEN
    RAISE EXCEPTION 'SYNTHETIC_CLEANUP_FAILED';
  END IF;
END `$`$;
"@
  try { Invoke-LocalPsqlFile $cleanupPath "$containerRoot-cleanup.sql" }
  finally {
    & docker exec $container sh -c "rm -f '$containerRoot-setup.sql' '$containerRoot-a.sql' '$containerRoot-b.sql' '$containerRoot-verify.sql' '$containerRoot-cleanup.sql'" | Out-Null
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
