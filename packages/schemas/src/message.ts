import { z } from 'zod'
import { LIMITS } from './common.ts'

/**
 * The body of every MUC groupchat message is JSON `{type, schemaVersion, content}` (SRD §3).
 * Sender identity comes from the stanza, never from the body (§3 rule 3, R9).
 */
export const chatMessageBodySchema = z
  .object({
    type: z.literal('chat'),
    schemaVersion: z.literal(1),
    content: z.object({
      text: z
        .string()
        .min(1)
        .max(LIMITS.messageTextChars)
        .describe('Plain text; rendered without HTML (PLY-14)'),
    }),
  })
  .describe('A chat room message')

/**
 * All message bodies, discriminated by `type`. Later room types add members here and in the
 * room-type registry (ARC-5).
 */
export const messageBodySchema = z.discriminatedUnion('type', [chatMessageBodySchema])

export type ChatMessageBody = z.infer<typeof chatMessageBodySchema>
export type MessageBody = z.infer<typeof messageBodySchema>
export type MessageType = MessageBody['type']
