/**
 * GET /api/threads — returns list of all conversations for the sidebar.
 */

import { scanConversations } from "@/app/api/chat/conversation-store";

export async function GET() {
  const result = scanConversations();
  return Response.json(result);
}
