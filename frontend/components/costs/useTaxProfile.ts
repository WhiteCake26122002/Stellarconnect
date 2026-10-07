"use client";

import { useCallback, useEffect, useState } from "react";
import { loadTaxProfile, saveTaxProfile } from "@/lib/costs/profile";
import { EMPTY_TAX_PROFILE, type TaxProfile } from "@/lib/costs/tax";

/** The tax profile for an account, loaded after mount (it lives in the browser) and saved on change. */
export function useTaxProfile(owner: string | null | undefined): [TaxProfile, (next: TaxProfile) => void, boolean] {
  const [profile, setProfile] = useState<TaxProfile>({ ...EMPTY_TAX_PROFILE });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (owner === undefined) return;
    setProfile(loadTaxProfile(owner));
    setReady(true);
  }, [owner]);

  const update = useCallback(
    (next: TaxProfile) => {
      setProfile(next);
      saveTaxProfile(owner, next);
    },
    [owner],
  );

  return [profile, update, ready];
}
