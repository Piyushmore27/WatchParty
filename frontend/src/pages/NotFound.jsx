import { useNavigate } from "react-router-dom";
import Button from "../components/ui/Button.jsx";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#DEDEDE] px-4 py-10 text-[#1D1D1D]">
      <section className="w-full max-w-lg rounded-2xl border border-[#D1D5DB] bg-white p-8 text-center shadow-sm sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#003399]">
          YouTube Watch Party
        </p>
        <h1 className="mt-5 text-7xl font-bold tracking-tight text-[#003399] sm:text-8xl">
          404
        </h1>
        <h2 className="mt-3 text-2xl font-semibold">Page Not Found</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#4A4A4A] sm:text-base">
          Sorry, we couldn’t find that page. It may have moved, or the URL may be incorrect.
        </p>
        <Button
          variant="primary"
          size="md"
          onClick={() => navigate("/")}
          className="mt-7 rounded-lg bg-[#003399] px-5 py-3 font-medium text-white transition hover:bg-[#002570]"
        >
          Go to Home
        </Button>
      </section>
    </main>
  );
}
