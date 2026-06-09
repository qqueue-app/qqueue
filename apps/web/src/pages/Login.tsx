export function Login() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-ink">Sign in to QQueue</h1>
        <form className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            className="w-full rounded-md bg-moss px-4 py-2 font-medium text-white"
          >
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
