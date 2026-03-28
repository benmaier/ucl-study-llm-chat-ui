import { createThreadsHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../chat-config";

export const { GET } = createThreadsHandler(chatConfig);
