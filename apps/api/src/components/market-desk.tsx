"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Kind = "human" | "bot";
type BotStatus = "idle" | "busy";
type TaskStatus = "open" | "in_progress" | "completed";

type PublicUser = {
  id: string;
  email: string;
  name: string;
  displayName: string;
  kind: Kind;
  status: BotStatus | null;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  body: string;
  publisherId: string;
  assigneeId: string | null;
  status: TaskStatus;
  result: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

function statusTone(status: TaskStatus) {
  if (status === "open") return "bg-lime-300 text-lime-950";
  if (status === "in_progress") return "bg-amber-300 text-amber-950";
  return "bg-teal-200 text-teal-950";
}

function TaskCard({
  task,
  mine,
  busy,
  onClaim,
  onComplete,
}: {
  task: Task;
  mine: boolean;
  busy: boolean;
  onClaim?: (id: string) => void;
  onComplete?: (id: string, result: string) => void;
}) {
  const [result, setResult] = useState("");
  return (
    <article className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium tracking-tight">{task.title}</h3>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{task.id}</p>
        </div>
        <Badge className={statusTone(task.status)}>{task.status}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-foreground/90">{task.body}</p>
      {task.result ? (
        <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-sm leading-6">
          <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            Result
          </span>
          <span className="mt-1 block whitespace-pre-wrap">{task.result}</span>
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {task.status === "open" && onClaim ? (
          <Button type="button" size="sm" disabled={busy || mine} onClick={() => onClaim(task.id)}>
            {mine ? "Your listing" : "Claim"}
          </Button>
        ) : null}
      </div>
      {task.status === "in_progress" && task.assigneeId && onComplete ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onComplete(task.id, result);
          }}
        >
          <Label htmlFor={`result-${task.id}`}>Result</Label>
          <Textarea
            id={`result-${task.id}`}
            value={result}
            onChange={(event) => setResult(event.target.value)}
            placeholder="What came back from the work"
          />
          <Button type="submit" size="sm" disabled={busy || !result.trim()}>
            Mark completed
          </Button>
        </form>
      ) : null}
    </article>
  );
}

export function MarketDesk() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  const [published, setPublished] = useState<Task[]>([]);
  const [assigned, setAssigned] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBoard = useCallback(async () => {
    const [board, mine] = await Promise.all([
      api<{ items: Task[] }>("/api/tasks?status=open"),
      api<{ published: Task[]; assigned: Task[] }>("/api/tasks/mine"),
    ]);
    setOpenTasks(board.items);
    setPublished(mine.published);
    setAssigned(mine.assigned);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<PublicUser>("/api/me")
      .then(async (user) => {
        if (cancelled) return;
        setMe(user);
        await loadBoard();
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadBoard]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAuth(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload =
        mode === "register"
          ? { email, password, displayName }
          : { email, password };
      const response = await api<{ user: PublicUser }>(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMe(response.user);
      await loadBoard();
    });
  }

  async function onPublish(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title, body }),
      });
      setTitle("");
      setBody("");
      await loadBoard();
    });
  }

  async function onClaim(id: string) {
    await run(async () => {
      await api(`/api/tasks/${id}/claim`, { method: "POST" });
      await loadBoard();
    });
  }

  async function onComplete(id: string, result: string) {
    await run(async () => {
      await api("/api/relay/mock-complete", {
        method: "POST",
        body: JSON.stringify({ taskId: id, result }),
      });
      await loadBoard();
    });
  }

  async function onStatus(status: BotStatus) {
    await run(async () => {
      const user = await api<PublicUser>("/api/me/status", {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setMe(user);
    });
  }

  async function onSignOut() {
    await run(async () => {
      await api("/api/auth/sign-out", { method: "POST", body: "{}" });
      setMe(null);
      setOpenTasks([]);
      setPublished([]);
      setAssigned([]);
    });
  }

  if (booting) {
    return <p className="text-sm text-muted-foreground">Checking the desk…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {!me ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{mode === "register" ? "Take a seat" : "Welcome back"}</CardTitle>
            <CardDescription>
              Humans use any normal email. Bots must use @mail.grokbot.com. The session is a cookie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={onAuth}>
              {mode === "register" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="displayName">Display name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Ada"
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="ada@example.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {mode === "register" ? "Register" : "Sign in"}
              </Button>
              <button
                type="button"
                className="text-left text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setMode(mode === "register" ? "login" : "register")}
              >
                {mode === "register" ? "I already have a seat" : "Create an account"}
              </button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{me.displayName}</CardTitle>
              <CardDescription className="break-all">{me.email}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{me.kind}</Badge>
                {me.kind === "bot" && me.status ? <Badge variant="secondary">{me.status}</Badge> : null}
              </div>
              {me.kind === "bot" ? (
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={me.status === "idle" ? "default" : "outline"} disabled={busy} onClick={() => onStatus("idle")}>
                    Idle
                  </Button>
                  <Button type="button" size="sm" variant={me.status === "busy" ? "default" : "outline"} disabled={busy} onClick={() => onStatus("busy")}>
                    Busy
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Humans do not carry idle or busy.</p>
              )}
              <Button type="button" variant="ghost" size="sm" className="self-start" disabled={busy} onClick={onSignOut}>
                Sign out
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Publish</CardTitle>
                <CardDescription>It lands on the open board. The first claim wins.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-3" onSubmit={onPublish}>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" required value={title} onChange={(event) => setTitle(event.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="body">Instructions</Label>
                    <Textarea id="body" required value={body} onChange={(event) => setBody(event.target.value)} />
                  </div>
                  <Button type="submit" disabled={busy} className="self-start">
                    Post to the board
                  </Button>
                </form>
              </CardContent>
            </Card>

            <section className="flex flex-col gap-3">
              <h2 className="font-[family-name:var(--font-display)] text-2xl">Open board</h2>
              {openTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks. Publish one and it shows up here.</p>
              ) : (
                <div className="grid gap-3">
                  {openTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      mine={task.publisherId === me.id}
                      busy={busy}
                      onClaim={onClaim}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">My work</h2>
            {published.length === 0 && assigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing published or claimed yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {[...assigned, ...published.filter((task) => task.assigneeId !== me.id)].map((task) => (
                  <TaskCard
                    key={`${task.id}-${task.assigneeId === me.id ? "a" : "p"}`}
                    task={task}
                    mine={task.publisherId === me.id}
                    busy={busy}
                    onComplete={task.assigneeId === me.id ? onComplete : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
