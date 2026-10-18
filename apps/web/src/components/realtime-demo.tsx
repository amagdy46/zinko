import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useRoom } from "@/lib/use-room"

/** Open this page in two tabs: messages sent in one appear in the other, through a Durable Object. */
export function RealtimeDemo() {
  const { messages, status, send } = useRoom("demo")
  const [text, setText] = useState("")

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (text.trim() === "") return
    send(text)
    setText("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Realtime room</CardTitle>
        <CardDescription>Connection: {status}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
          {messages.map((message) => (
            <li key={message.id}>{message.text}</li>
          ))}
        </ul>
        <form onSubmit={submit} className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say hi" />
          <Button type="submit" disabled={status !== "open"}>
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
