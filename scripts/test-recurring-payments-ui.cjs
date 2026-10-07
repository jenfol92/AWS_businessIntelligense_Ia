// Browser integration with the real modal and a synthetic local HTTP server. No real account/ERP API.
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.FINANCE_PLAYWRIGHT_MODULE || 'playwright');
const compiled = require('next/dist/compiled/webpack/webpack');
compiled.init();
const root = process.cwd();
const work = path.join(root,'outputs','finance-ui-tests');
fs.mkdirSync(work,{recursive:true});
fs.writeFileSync(path.join(work,'loader.cjs'), `module.exports=function(source){return require(${JSON.stringify(require.resolve('typescript'))}).transpileModule(source,{compilerOptions:{jsx:4,target:7,module:99}}).outputText}`);
fs.writeFileSync(path.join(work,'fixture.jsx'), `import React from 'react'; import {createRoot} from 'react-dom/client';
import {RecurringPaymentModal} from ${JSON.stringify(path.join(root,'modules/finance/components/RecurringPaymentModal.tsx'))};
function Fixture(){const [open,setOpen]=React.useState(false);return <><button onClick={()=>setOpen(true)}>Abrir pago</button>{open&&<RecurringPaymentModal onClose={()=>setOpen(false)} onSaved={async()=>{}}/>}</>};
createRoot(document.getElementById('root')).render(<Fixture/>);`);
const uuid='f1000000-0000-4000-8000-000000000001';
const committed = new Map();
const posts=[];
let drop=true, hideStatus=false;
const json=(res,data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(work,'bundle.js')));return;}
  if(req.url.startsWith('/api/finance/recurring-payments')){
    if(req.method==='GET'){
      const url=new URL(req.url,'http://localhost');
      if(url.searchParams.has('operationId')) return json(res,{ok:true,data:{state:!hideStatus&&committed.has(url.searchParams.get('operationId'))?'confirmed':'not_found',result:{obligation_id:uuid}}});
      return json(res,{ok:true,operationScope:'test-project:test-user',types:[{id:uuid,name:'Seguridad Social',category:'social_security'}],accounts:[{id:uuid,name:'Cuenta prueba',balance:10000,currency:'EUR'}]});
    }
    let raw='';for await(const chunk of req)raw+=chunk;
    const payload=JSON.parse(raw);posts.push(payload.idempotency_key);
    if(!committed.has(payload.idempotency_key))committed.set(payload.idempotency_key,raw);
    else assert.equal(committed.get(payload.idempotency_key),raw);
    if(drop){drop=false;res.setHeader('Content-Type','application/json');res.end('{"ok":');return;}
    return json(res,{ok:true,data:{obligation_id:payload.idempotency_key}});
  }
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
async function run(){
  await new Promise((resolve,reject)=>compiled.webpack({mode:'development',entry:path.join(work,'fixture.jsx'),output:{path:work,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.jsx','.js']},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:path.join(work,'loader.cjs')}] } } ,(error,stats)=>error?reject(error):stats.hasErrors()?reject(Error(stats.toString({all:false,errors:true}))):resolve()));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();context.setDefaultTimeout(6000);
    const page=await context.newPage();
    const url=`http://127.0.0.1:${server.address().port}`;
    const pending=p=>p.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('finance.recurring.pending.')).map(key=>JSON.parse(localStorage.getItem(key))));
    const open=async p=>{await p.goto(url);await p.getByRole('button',{name:'Abrir pago'}).click();await p.getByLabel('Cuenta bancaria').waitFor();};
    const fill=async p=>{await p.getByLabel('Concepto').fill('Salario prueba');await p.getByLabel('Importe EUR').fill('1000');await p.getByLabel('Cuenta bancaria').selectOption(uuid);await p.getByLabel('Acción').selectOption('paid');};
    await open(page);await fill(page);await page.getByRole('button',{name:'Crear pago recurrente',exact:true}).click();
    await page.getByRole('button',{name:'Comprobar estado'}).waitFor().catch(async error=>{console.log('UI_STATE',await page.locator('body').innerText(),'POSTS',posts.length);throw error;});
    assert.equal(await page.getByRole('button',{name:'Cerrar',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').isVisible(),true);
    const operation=(await pending(page))[0];assert.ok(operation);
    await open(page);await page.getByRole('button',{name:'Comprobar estado'}).waitFor();
    assert.equal((await pending(page))[0].operationId,operation.operationId);
    hideStatus=true;await page.getByRole('button',{name:'Comprobar estado'}).click();
    await page.getByText('Todavía no hay confirmación.',{exact:false}).waitFor();
    assert.equal((await pending(page))[0].operationId,operation.operationId);
    hideStatus=false;await page.getByRole('button',{name:'Comprobar estado'}).click();
    await page.locator('dialog').waitFor({state:'detached'});assert.equal((await pending(page)).length,0);assert.equal(posts.length,1);
    // Two tabs prepare a form, but the second cannot reserve a new UUID while the first is uncertain.
    const other=await context.newPage();await open(page);await fill(page);await open(other);await fill(other);
    drop=true;await page.getByRole('button',{name:'Crear pago recurrente',exact:true}).click();
    await page.getByRole('button',{name:'Comprobar estado'}).waitFor();
    await other.getByRole('button',{name:'Crear pago recurrente',exact:true}).click();await other.getByRole('button',{name:'Comprobar estado'}).waitFor();
    assert.equal(posts.length,2);
    await other.getByRole('button',{name:'Reintentar misma operación'}).click();await other.locator('dialog').waitFor({state:'detached'});
    assert.equal(posts[1],posts[2]);assert.equal(committed.size,2);
    await page.getByRole('button',{name:'Comprobar estado'}).click();await page.locator('dialog').waitFor({state:'detached'});
    console.log('PASS: real modal blocks close/Escape, restores after reload, retains not_found, checks confirmation, and reuses one operation across two tabs and retry.');
  }finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
