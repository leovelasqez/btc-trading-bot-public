/**
 * Parser y schema Zod para la respuesta de Gemini AI en gestión de orden límite pendiente
 */
import { z } from 'zod';

export const limitOrderManagementSchema = z.object({
  action: z.enum(['KEEP', 'CANCEL', 'REPLACE']),
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string().min(10, 'Reasoning demasiado corto'),
  new_order_type: z.enum(['MARKET', 'LIMIT']).nullable().default(null),
  new_entry_price: z.number().min(0).nullable().default(null),
  new_stop_loss: z.number().min(0).nullable().default(null),
  new_take_profit: z.number().min(0).nullable().default(null),
  new_risk_reward_ratio: z.number().min(0).nullable().default(null),
  warnings: z.array(z.string()).default([]),
});

export type LimitOrderManagementResponse = z.infer<typeof limitOrderManagementSchema>;

/**
 * Parsea la respuesta raw de Gemini para gestión de orden límite pendiente
 */
export function parseLimitOrderManagementResponse(rawText: string): {
  success: true;
  data: LimitOrderManagementResponse;
} | {
  success: false;
  error: string;
  rawText: string;
} {
  try {
    let cleaned = rawText.trim();

    // Remover ```json ... ``` o ``` ... ```
    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1]!.trim();
    }

    // Intentar encontrar JSON si hay texto antes/después
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    const parsed = JSON.parse(cleaned);
    const validated = limitOrderManagementSchema.parse(parsed);

    // Para KEEP y CANCEL, normalizar todos los campos new_* a null
    if (validated.action === 'KEEP' || validated.action === 'CANCEL') {
      validated.new_order_type = null;
      validated.new_entry_price = null;
      validated.new_stop_loss = null;
      validated.new_take_profit = null;
      validated.new_risk_reward_ratio = null;
      return { success: true, data: validated };
    }

    // Validaciones de lógica de negocio para REPLACE
    if (validated.action === 'REPLACE') {
      if (validated.new_order_type === null) {
        return {
          success: false,
          error: 'REPLACE requiere new_order_type (MARKET o LIMIT)',
          rawText,
        };
      }

      if (validated.new_entry_price === null) {
        return {
          success: false,
          error: 'REPLACE requiere new_entry_price',
          rawText,
        };
      }

      if (validated.new_stop_loss === null) {
        return {
          success: false,
          error: 'REPLACE requiere new_stop_loss',
          rawText,
        };
      }

      // Validar lógica entry vs SL para LIMIT orders
      // (Para MARKET también aplica: SL siempre debe estar en el lado correcto del entry)
      // Nota: no sabemos el side aquí directamente, pero podemos inferirlo del SL vs entry
      // Sin embargo, para mayor seguridad, validamos que entry != SL
      if (validated.new_entry_price === validated.new_stop_loss) {
        return {
          success: false,
          error: 'REPLACE: new_entry_price no puede ser igual a new_stop_loss',
          rawText,
        };
      }

      // Si hay take_profit, validar que esté en el lado correcto
      if (validated.new_take_profit !== null) {
        // Inferir side por la relación SL/entry
        const inferredLong = validated.new_stop_loss < validated.new_entry_price;

        if (inferredLong) {
          // LONG: TP debe ser > entry
          if (validated.new_take_profit <= validated.new_entry_price) {
            return {
              success: false,
              error: 'REPLACE LONG: new_take_profit debe ser mayor que new_entry_price',
              rawText,
            };
          }
        } else {
          // SHORT: TP debe ser < entry
          if (validated.new_take_profit >= validated.new_entry_price) {
            return {
              success: false,
              error: 'REPLACE SHORT: new_take_profit debe ser menor que new_entry_price',
              rawText,
            };
          }
        }
      }
    }

    return { success: true, data: validated };
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : err instanceof Error
        ? err.message
        : 'Unknown parsing error';

    return {
      success: false,
      error: message,
      rawText,
    };
  }
}
