// shared/layout/UserHeaderInfo.tsx

"use client";

export default function UserHeaderInfo() {
  return (
    <div className="d-flex align-items-center gap-3">
      {/* Aquí luego meteremos IA */}
      <button className="btn btn-sm btn-outline-secondary">
        🤖 IA
      </button>

      {/* Usuario */}
      <div className="small text-muted">
        Usuario
      </div>
    </div>
  );
}