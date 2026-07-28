// Trusted identity attached by requireAuth after verifying the session server-side.
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string;
        tenantId: string;
        role: string;
      };
    }
  }
}

export {};
