"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Lock,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError } from "@/lib/api";
import { login, registerAdmin } from "@/lib/auth";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("signin");
  const [loading, setLoading] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [schoolName, setSchoolName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { school } = await login(email, password);
        toast.success(`Welcome back to ${school.name}`);
      } else {
        const { school } = await registerAdmin(email, password, schoolName);
        toast.success(`Workspace ready — welcome to ${school.name}`);
      }
      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const isSignIn = mode === "signin";

  return (
    <div className="grid min-h-screen lg:grid-cols-2 bg-app">
      {/* Left — Form */}
      <div className="flex flex-col justify-between p-8 lg:p-12">
        <Link
          href="/"
          className="flex items-center gap-2.5 focus-ring rounded-md w-fit"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span className="text-md font-semibold tracking-tight">
            Scholaris
          </span>
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm animate-fade-in-up">
            <div className="mb-8 space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {isSignIn ? "Welcome back" : "Create your workspace"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isSignIn
                  ? "Sign in to your school workspace to continue."
                  : "Set up a new school in under a minute."}
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {!isSignIn && (
                <Input
                  label="School name"
                  placeholder="Oakridge International"
                  leftIcon={<Building2 className="h-4 w-4" />}
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                  autoFocus
                />
              )}
              <Input
                label="Email"
                type="email"
                placeholder="you@school.edu"
                leftIcon={<Mail className="h-4 w-4" />}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <div>
                <Input
                  label="Password"
                  type="password"
                  placeholder={
                    isSignIn
                      ? "••••••••"
                      : "Min 8 chars with an uppercase & number"
                  }
                  leftIcon={<Lock className="h-4 w-4" />}
                  autoComplete={isSignIn ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                {isSignIn && (
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <label className="inline-flex items-center gap-2 text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus-ring"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      className="font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={loading}
                rightIcon={
                  !loading ? <ArrowRight className="h-4 w-4" /> : undefined
                }
              >
                {isSignIn ? "Sign in" : "Create workspace"}
              </Button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              {isSignIn ? (
                <>
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                    }}
                    className="font-medium text-foreground hover:text-primary transition-colors"
                  >
                    Start a free trial
                  </button>
                </>
              ) : (
                <>
                  Already have a workspace?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signin");
                      setError(null);
                    }}
                    className="font-medium text-foreground hover:text-primary transition-colors"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Scholaris, Inc. All rights reserved.
        </p>
      </div>

      {/* Right — Showcase */}
      <div className="relative hidden lg:flex flex-col overflow-hidden border-l border-border bg-gradient-to-br from-primary-50 via-background to-background">
        <div className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
        <div className="absolute -top-20 -right-20 h-[420px] w-[420px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-0 -left-20 h-[320px] w-[320px] rounded-full bg-primary/10 blur-3xl" />

        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface/60 backdrop-blur px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            SOC 2 Type II compliant
          </div>

          <div className="max-w-md space-y-5">
            <h2 className="text-4xl font-semibold tracking-tight text-foreground">
              Run your school like the best SaaS companies.
            </h2>
            <p className="text-md text-muted-foreground leading-relaxed">
              Admissions, attendance, exams, fees, and parent communication —
              all in one beautifully designed workspace built for modern
              educators.
            </p>

            <div className="flex items-center gap-6 pt-4">
              <Stat label="Schools" value="1,240+" />
              <div className="h-8 w-px bg-border" />
              <Stat label="Students" value="820K" />
              <div className="h-8 w-px bg-border" />
              <Stat label="Uptime" value="99.99%" />
            </div>
          </div>

          <blockquote className="max-w-md border-l-2 border-primary pl-4">
            <p className="text-sm text-foreground leading-relaxed">
              &ldquo;Scholaris replaced five different tools. Our teachers save
              six hours a week, and parents finally have visibility.&rdquo;
            </p>
            <footer className="mt-3 text-xs text-muted-foreground">
              Dr. Priya Menon — Principal, Oakridge International
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
