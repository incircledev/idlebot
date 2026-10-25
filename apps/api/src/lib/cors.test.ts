import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedOrigin, configuredOrigins, publicAuthBaseURL, type OriginEnv } from "./cors";

const emptyEnv: OriginEnv = {};

describe("configuredOrigins", () => {
  it("keeps the Vite dev origin on 5190 when no deploy env is set", () => {
    assert.equal(allowedOrigin("http://127.0.0.1:5190", emptyEnv), "http://127.0.0.1:5190");
    assert.equal(allowedOrigin("http://localhost:5190", emptyEnv), "http://localhost:5190");
  });

  it("rejects an origin that is not local and not configured", () => {
    assert.equal(allowedOrigin("https://evil.example", emptyEnv), null);
    assert.equal(allowedOrigin(null, emptyEnv), null);
    assert.equal(allowedOrigin("null", emptyEnv), null);
  });

  it("trusts BETTER_AUTH_URL, Vercel hosts, and TRUSTED_ORIGINS without dropping localhost", () => {
    const env = {
      BETTER_AUTH_URL: "https://idlebot.vercel.app/",
      VERCEL_URL: "idlebot-git-preview-user.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "idlebot.vercel.app",
      VERCEL_BRANCH_URL: "idlebot-git-main-user.vercel.app",
      TRUSTED_ORIGINS: "https://hall.example, https://extra.example",
    };
    const origins = configuredOrigins(env);
    assert.ok(origins.includes("http://127.0.0.1:5190"));
    assert.ok(origins.includes("https://idlebot.vercel.app"));
    assert.ok(origins.includes("https://idlebot-git-preview-user.vercel.app"));
    assert.ok(origins.includes("https://idlebot-git-main-user.vercel.app"));
    assert.ok(origins.includes("https://hall.example"));
    assert.ok(origins.includes("https://extra.example"));
    assert.equal(allowedOrigin("https://idlebot.vercel.app", env), "https://idlebot.vercel.app");
    assert.equal(allowedOrigin("https://elsewhere.example", env), null);
  });

  it("passes a wildcard TRUSTED_ORIGINS entry through unchanged", () => {
    const env: OriginEnv = { TRUSTED_ORIGINS: "https://*.example.com" };
    assert.ok(configuredOrigins(env).includes("https://*.example.com"));
  });
});

describe("publicAuthBaseURL", () => {
  it("uses BETTER_AUTH_URL outside Vercel", () => {
    assert.equal(
      publicAuthBaseURL({ BETTER_AUTH_URL: "http://127.0.0.1:3000" }),
      "http://127.0.0.1:3000",
    );
  });

  it("uses the preview deployment host even when BETTER_AUTH_URL is the production origin", () => {
    assert.equal(
      publicAuthBaseURL({
        VERCEL_ENV: "preview",
        VERCEL_URL: "idlebot-git-feat-user.vercel.app",
        BETTER_AUTH_URL: "https://idlebot.vercel.app",
      }),
      "https://idlebot-git-feat-user.vercel.app",
    );
  });

  it("uses BETTER_AUTH_URL for production", () => {
    assert.equal(
      publicAuthBaseURL({
        VERCEL_ENV: "production",
        VERCEL_URL: "idlebot-abc123.vercel.app",
        BETTER_AUTH_URL: "https://idlebot.vercel.app",
      }),
      "https://idlebot.vercel.app",
    );
  });
});
