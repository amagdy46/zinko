import { createFileRoute, Link } from "@tanstack/react-router"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/")({ component: Landing })

const features = [
  { title: "Effect 4", description: "Typed errors and services, composed with layers." },
  { title: "TanStack Start", description: "Full-stack React with server functions." },
  {
    title: "Cloudflare Workers",
    description: "Deployed at the edge, configured in wrangler.jsonc.",
  },
]

function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold">My app</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild>
            <Link to="/app">Open app</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-10 px-6 py-16">
        <div className="space-y-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Ship your idea</h1>
          <p className="mx-auto max-w-xl text-muted-foreground">
            A fresh Effect + TanStack Start + Cloudflare monorepo. Edit{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">apps/web/src/routes</code> to
            make it yours.
          </p>
        </div>
        <div className="grid w-full gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <CardTitle>{f.title}</CardTitle>
                <CardDescription>{f.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}
