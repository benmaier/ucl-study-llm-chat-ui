import { createMessagesHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../../../chat-config";

export const { GET } = createMessagesHandler(chatConfig);
