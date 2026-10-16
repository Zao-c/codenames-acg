import { useEffect, useState } from 'react';
import { getFeatures } from './api';
let featureRequest: Promise<boolean> | undefined;
export function useCommunityEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    featureRequest ??= getFeatures().then(f => f.animeCommunity).catch(() => false);
    featureRequest.then(value => { if (active) setEnabled(value); });
    return () => { active = false; };
  }, []);
  return enabled;
}
