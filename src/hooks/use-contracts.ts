/**
 * Contract loading hooks.
 *
 * Reload on focus rather than caching in a store: mutations happen on detail
 * screens and in the import queue, and re-reading on return is simpler and less
 * wrong than invalidating a cache from four places. The dataset is a handful of
 * records, so the read is cheap.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getContract, listContracts } from '@/data/repository';
import type { ContractRecord } from '@/domain/record';

export function useContracts() {
  const [contracts, setContracts] = useState<ContractRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Seeding happens once at app start in the root layout, not here — doing it
      // per-screen leaves every other entry point looking at an empty library.
      setContracts(await listContracts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read stored contracts.');
      setContracts([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { contracts, error, reload: load, loading: contracts === null };
}

export function useContract(id: string | undefined) {
  const [contract, setContract] = useState<ContractRecord | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!id) {
      setContract(null);
      return;
    }
    setContract(await getContract(id));
  }, [id]);

  // `useFocusEffect` already fires on mount, so a companion `useEffect` would load
  // twice on every entry — once redundantly, and each one a setState.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { contract, reload: load, loading: contract === undefined };
}
