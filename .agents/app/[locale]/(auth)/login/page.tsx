"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/server/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setLoading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError("Credenciales incorrectas. Revisa tu email y contraseña.");
      setLoading(false);
      return;
    }

    if (!data?.user) {
      setError("No se pudo recuperar la sesión del usuario.");
      setLoading(false);
      return;
    }

    router.push("/productos");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="p-8">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-slate-800">BI Manager</h2>
            <p className="mt-2 text-slate-500">
              Panel de Control de Amazon & Logística
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Email Corporativo
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 text-slate-400" size={20} />
                <input
                  type="email"
                  required
                  className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 outline-none transition focus:ring-2 focus:ring-blue-500"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-slate-400" size={20} />
                <input
                  type="password"
                  required
                  className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 outline-none transition focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 font-bold text-white shadow-lg transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? <Loader2 className="animate-spin" /> : "Entrar al Panel"}
            </button>
          </form>
        </div>

        <div className="border-t border-slate-100 bg-slate-50 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-slate-400">
            Safe & Encrypted Session
          </p>
        </div>
      </div>
    </div>
  );
}