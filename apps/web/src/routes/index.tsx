import { createFileRoute, Link } from "@tanstack/react-router"
import { Brand } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/")({ component: Landing })

function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <Link to="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/sign-up">Sign up</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Zinko</h1>
        <p className="max-w-xl text-muted-foreground">
          Open-source tracking auditor: see what fires under each consent choice, with the request
          that proves it.
        </p>
        <Button asChild size="lg">
          <Link to="/app">Open app</Link>
        </Button>
      </main>
    </div>
  )
}
