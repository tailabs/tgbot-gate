import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, withMinRefreshDuration } from "../lib/api";

export type AuditListItem = {
  shard: string;
  id: number;
  ts_ms: number;
  method: string;
  path: string;
  kind: string;
  status: number;
  latency_ms: number;
  client_ip: string;
};

export type AuditDetail = AuditListItem & {
  request_body?: string | null;
  response_body?: string | null;
};

type AuditListResponse = {
  entries: AuditListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

type AuditStatusResponse = {
  enabled: boolean;
};

type Notice = {
  kind: "idle" | "info" | "error";
  text: string;
};

type FetchPageOptions = {
  closeModal?: boolean;
  minDuration?: boolean;
};

export const AUDIT_PAGE_SIZE = 20;

export function auditEntryKey(item: Pick<AuditListItem, "shard" | "id">): string {
  return `${item.shard}:${item.id}`;
}

export function useAuditLog(active: boolean) {
  const [captureEnabled, setCaptureEnabled] = useState<boolean | null>(null);
  const [isListLoading, setIsListLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<AuditListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [modalEntry, setModalEntry] = useState<AuditListItem | null>(null);
  const [modalDetail, setModalDetail] = useState<AuditDetail | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, AuditDetail>>({});
  const [notice, setNotice] = useState<Notice>({ kind: "idle", text: "" });

  const searchRef = useRef(search);
  searchRef.current = search;

  const captureEnabledRef = useRef(captureEnabled);
  captureEnabledRef.current = captureEnabled;

  const detailCacheRef = useRef(detailCache);
  detailCacheRef.current = detailCache;

  const closeModal = useCallback(() => {
    setModalEntry(null);
    setModalDetail(null);
    setIsDetailLoading(false);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const status = await api<AuditStatusResponse>("/api/audit/status");
      setCaptureEnabled(status.enabled);
      if (!status.enabled) {
        setNotice({ kind: "info", text: "Audit capture is off. Enable it in Settings." });
        setEntries([]);
        setTotal(0);
        setTotalPages(1);
        closeModal();
        setDetailCache({});
      } else {
        setNotice({ kind: "idle", text: "" });
      }
    } catch {
      setCaptureEnabled(false);
      setNotice({ kind: "error", text: "Could not read audit status." });
    }
  }, [closeModal]);

  const fetchPage = useCallback(
    async (targetPage: number, options: FetchPageOptions = {}) => {
      if (!captureEnabledRef.current) {
        return;
      }

      const { closeModal: shouldCloseModal = true, minDuration = true } = options;
      setIsListLoading(true);

      const run = async () => {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        params.set("page_size", String(AUDIT_PAGE_SIZE));
        const query = searchRef.current.trim();
        if (query) {
          params.set("q", query);
        }

        const data = await api<AuditListResponse>(`/api/audit?${params.toString()}`);
        setEntries(data.entries);
        setPage(data.page);
        setTotal(data.total);
        setTotalPages(data.total_pages);
        setNotice({ kind: "idle", text: "" });

        if (shouldCloseModal) {
          setModalEntry(null);
          setModalDetail(null);
        }
      };

      try {
        if (minDuration) {
          await withMinRefreshDuration(run);
        } else {
          await run();
        }
      } catch (error) {
        setEntries([]);
        setTotal(0);
        setTotalPages(1);
        closeModal();
        setDetailCache({});
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Audit refresh failed.";
        setNotice({ kind: "error", text: message });
      } finally {
        setIsListLoading(false);
      }
    },
    [closeModal],
  );

  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadStatus();
  }, [active, loadStatus]);

  useEffect(() => {
    if (!active || captureEnabled !== true) {
      return;
    }
    void fetchPageRef.current(1, { closeModal: false, minDuration: false });
  }, [active, captureEnabled]);

  const openDetail = useCallback(async (item: AuditListItem) => {
    const key = auditEntryKey(item);
    setModalEntry(item);

    const cached = detailCacheRef.current[key];
    if (cached) {
      setModalDetail(cached);
      return;
    }

    setModalDetail(null);
    setIsDetailLoading(true);
    try {
      const detail = await api<AuditDetail>(`/api/audit/${item.shard}/${item.id}`);
      setDetailCache((current) => ({ ...current, [key]: detail }));
      setModalDetail(detail);
    } catch {
      setNotice({ kind: "error", text: "Failed to load audit detail." });
      setModalEntry(null);
      setModalDetail(null);
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  const runSearch = useCallback(() => {
    void fetchPage(1);
  }, [fetchPage]);

  const refresh = useCallback(() => {
    if (captureEnabled) {
      void fetchPage(page);
    } else {
      void loadStatus();
    }
  }, [captureEnabled, fetchPage, loadStatus, page]);

  const goToPage = useCallback(
    (targetPage: number) => {
      void fetchPage(targetPage);
    },
    [fetchPage],
  );

  return {
    captureEnabled,
    closeModal,
    entries,
    goToPage,
    isDetailLoading,
    isListLoading,
    modalDetail,
    modalEntry,
    notice,
    openDetail,
    page,
    refresh,
    runSearch,
    search,
    setSearch,
    total,
    totalPages,
  };
}
