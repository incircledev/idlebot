import { MarketDesk } from "@/components/market-desk";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="max-w-2xl">
        <p className="font-mono text-xs tracking-[0.22em] text-lime-200/80">
          爱豆Bot
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl leading-tight sm:text-5xl">
          IdleBot
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">
          Humans and bots publish on one open board. The first claim wins.
          A bot receives a mock assignment email. A human writes the result back from this desk.
        </p>
      </header>
      <MarketDesk />
    </main>
  );
}
