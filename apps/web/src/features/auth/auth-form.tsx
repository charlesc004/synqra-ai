"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRight,
  AudioLines,
  Check,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { api, json } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { CosmicScene } from "./cosmic-scene";
// Use interpreted validation: Zod's JIT capability probe itself violates strict CSP.
z.config({ jitless: true });
const schema = z.object({
  name: z.string().max(120),
  email: z.email(),
  password: z.string().min(12, "Use at least 12 characters").max(128),
});
export function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter(),
    cache = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "" },
  });
  async function submit(values: z.infer<typeof schema>) {
    try {
      await api(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        ...json(values),
      });
      await cache.invalidateQueries();
      router.push("/dashboard");
    } catch (e) {
      form.setError("root", {
        message: e instanceof Error ? e.message : "Sign in failed",
      });
    }
  }
  return (
    <main className="auth-page">
      <CosmicScene />
      <section className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <AudioLines />
          </span>
          SYNQRA<span>AI</span>
        </Link>
        <div className="auth-story-content">
          <div className="eyebrow">
            <span className="status-dot online" /> INTELLIGENCE, CONNECTED
          </div>
          <h1>
            Great answers start
            <br />
            with <em>your knowledge.</em>
          </h1>
          <p>
            Bring your team’s documents, decisions, and intelligence together in
            one thoughtful workspace.
          </p>
          <div className="auth-promises">
            <span>
              <Check size={14} /> Source-backed answers
            </span>
            <span>
              <Check size={14} /> Private by design
            </span>
          </div>
        </div>
        <div className="auth-story-footer">
          A clearer way to work with what you know.
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="eyebrow">YOUR KNOWLEDGE WORKSPACE</div>
          <h2>{register ? "Make room for better ideas." : "Welcome back."}</h2>
          <p className="muted">
            {register
              ? "Create an account and connect your team's knowledge."
              : "Sign in to pick up where your thinking left off."}
          </p>
          <form onSubmit={form.handleSubmit(submit)} className="form-stack">
            {register && (
              <label>
                Full name
                <input
                  {...form.register("name", { required: true })}
                  autoComplete="name"
                  required
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                {...form.register("email")}
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
              />
              {form.formState.errors.email && (
                <span className="field-error">Enter a valid email address</span>
              )}
            </label>
            <label>
              Password
              <input
                {...form.register("password")}
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder="At least 12 characters"
              />
              {form.formState.errors.password && (
                <span className="field-error">
                  {form.formState.errors.password.message}
                </span>
              )}
            </label>
            {form.formState.errors.root && (
              <p role="alert" className="field-error">
                {form.formState.errors.root.message}
              </p>
            )}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <>
                  {register
                    ? "Create your workspace"
                    : "Sign in to your workspace"}
                  <ArrowRight size={17} />
                </>
              )}
            </Button>
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to SYNQRA?"}{" "}
            <Link href={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <div className="auth-security">
            <ShieldCheck size={16} />
            <span>Your workspace. Your knowledge. Your control.</span>
          </div>
        </div>
        <span className="auth-copyright">
          © {new Date().getFullYear()} SYNQRA AI
        </span>
      </section>
    </main>
  );
}
