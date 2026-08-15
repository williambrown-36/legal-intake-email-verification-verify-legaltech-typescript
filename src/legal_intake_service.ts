import { createServer } from "node:http";
import { ZodError } from "zod";
import { defaultEmailSender, InfraiError } from "./infrai_email";
import { beginLegalSignup, signupRequestSchema } from "./signup_verification";

const port = Number(process.env.PORT ?? 3000);
const verificationBaseUrl = process.env.VERIFICATION_BASE_URL ?? `http://localhost:${port}`;

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/signup") {
    response.writeHead(404).end();
    return;
  }

  try {
    const body = signupRequestSchema.parse(await readJson(request));
    const result = await beginLegalSignup(body, verificationBaseUrl, defaultEmailSender);
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof ZodError) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_request", issues: error.issues }));
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      response.writeHead(error.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.code, message: error.message }));
      return;
    }
    console.error(error);
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "service_error" }));
  }
});

server.listen(port, () => {
  console.log(`Legal intake service listening on http://localhost:${port}`);
});
