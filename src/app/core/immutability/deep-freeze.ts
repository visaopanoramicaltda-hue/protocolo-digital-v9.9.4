
import { environment } from '../../../environments/environment';

export function deepFreeze<T>(obj: T): T {
  // Flag de segurança para não impactar performance em produção.
  // Em produção, retorna o objeto original sem processamento (Identity function).
  if (!environment.enableImmutabilityChecks) return obj;

  // Congela o objeto atual (nível raso)
  Object.freeze(obj as any);

  // Percorre propriedades para congelamento recursivo (Deep Freeze)
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value: any = (obj as any)[prop];
    // Se a propriedade for um objeto e ainda não estiver congelada, recurse.
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  });

  return obj;
}
