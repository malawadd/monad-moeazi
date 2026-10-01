import type { AuthConfig } from "convex/server";

const authConfig = {
  providers: [
    {
      type: "customJwt",
      issuer: process.env.PARTICLE_CONVEX_JWT_ISSUER!,
      jwks: process.env.PARTICLE_CONVEX_JWKS_URL!,
      algorithm: "RS256",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;

export default authConfig;
