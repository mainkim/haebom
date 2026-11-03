import { handleParticipantRequest } from "@/lib/participant-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return handleParticipantRequest(req);
}

export function POST(req: Request) {
  return handleParticipantRequest(req);
}
