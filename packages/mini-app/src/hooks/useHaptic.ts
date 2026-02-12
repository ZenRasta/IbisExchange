import {
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
} from '@telegram-apps/sdk-react';

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

export function useHaptic() {
  const impact = (style: ImpactStyle = 'medium') => {
    try {
      hapticFeedbackImpactOccurred(style);
    } catch {
      // Haptic not available
    }
  };

  const notification = (type: 'error' | 'success' | 'warning') => {
    try {
      hapticFeedbackNotificationOccurred(type);
    } catch {
      // Haptic not available
    }
  };

  return { impact, notification };
}
