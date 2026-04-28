"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpen, RotateCw, AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  classesApi,
  type ClassDto,
  type ClassWithSections,
} from "@/lib/classes";
import type { SectionDto } from "@/lib/sections";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClassCard } from "@/components/classes/ClassCard";
import { QuickAddClass } from "@/components/classes/QuickAddClass";
import { EditClassDialog } from "@/components/classes/EditClassDialog";
import { DeleteClassDialog } from "@/components/classes/DeleteClassDialog";

export default function ClassesPage() {
  const router = useRouter();
  const [list, setList] = React.useState<ClassWithSections[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editTarget, setEditTarget] = React.useState<ClassWithSections | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    React.useState<ClassWithSections | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await classesApi.list();
      setList(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load classes.";
      setError(msg);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const isEmpty = !loading && !error && (list?.length ?? 0) === 0;
  const hasItems = !loading && !error && (list?.length ?? 0) > 0;

  const handleQuickAdd = async (name: string) => {
    // Class list is small and orders by createdAt desc — a single create
    // + prepend is fine; no need for a full optimistic swap dance.
    try {
      const created = await classesApi.create({ name });
      setList((prev) => {
        const next: ClassWithSections = { ...created, sections: [] };
        return prev ? [next, ...prev] : [next];
      });
      toast.success(`${created.name} added`, {
        description: "Add sections inline to organize students.",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to add class.";
      toast.error(msg);
    }
  };

  const handleClassUpdated = (updated: ClassDto) => {
    setList((prev) =>
      prev
        ? prev.map((k) =>
            k.id === updated.id ? { ...k, ...updated } : k,
          )
        : prev,
    );
  };

  const handleClassDeleted = (id: string) => {
    setList((prev) => (prev ? prev.filter((k) => k.id !== id) : prev));
  };

  const handleSectionAdded = (classId: string, section: SectionDto) => {
    setList((prev) =>
      prev
        ? prev.map((k) =>
            k.id === classId
              ? {
                  ...k,
                  sections: [...k.sections, section].sort((a, b) =>
                    a.name.localeCompare(b.name),
                  ),
                }
              : k,
          )
        : prev,
    );
  };

  const handleSectionRemoved = (classId: string, sectionId: string) => {
    setList((prev) =>
      prev
        ? prev.map((k) =>
            k.id === classId
              ? {
                  ...k,
                  sections: k.sections.filter((s) => s.id !== sectionId),
                }
              : k,
          )
        : prev,
    );
  };

  return (
    <div className="space-y-6">
      <Header
        count={list?.length ?? 0}
        loading={loading}
        onRefresh={refresh}
      />

      {hasItems && (
        <QuickAddClass onSubmit={handleQuickAdd} className="max-w-xl" />
      )}

      <div
        key={loading ? "loading" : error ? "error" : isEmpty ? "empty" : "ready"}
        className="animate-fade-in-up"
      >
        {loading && <ClassesSkeleton />}

        {!loading && error && <ErrorBanner message={error} onRetry={refresh} />}

        {isEmpty && (
          <div className="space-y-6">
            <div className="glass rounded-xl">
              <EmptyState
                icon={<BookOpen className="h-10 w-10" strokeWidth={1.5} />}
                title="Create your first class to organize students"
                description="Classes hold sections (A, B, C…). Students can be assigned to a section so attendance, grades, and schedules stay structured."
              />
            </div>
            <QuickAddClass onSubmit={handleQuickAdd} className="max-w-xl" />
          </div>
        )}

        {hasItems && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {list!.map((klass) => (
              <ClassCard
                key={klass.id}
                klass={klass}
                onEditClass={setEditTarget}
                onDeleteClass={setDeleteTarget}
                onSectionAdded={handleSectionAdded}
                onSectionRemoved={handleSectionRemoved}
              />
            ))}
          </div>
        )}
      </div>

      <EditClassDialog
        klass={editTarget}
        onClose={() => setEditTarget(null)}
        onUpdated={handleClassUpdated}
      />
      <DeleteClassDialog
        klass={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleClassDeleted}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({
  count,
  loading,
  onRefresh,
}: {
  count: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Classes
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading ? (
            <Skeleton className="inline-block h-3 w-28" />
          ) : count === 0 ? (
            "No classes yet — set up your academic structure."
          ) : (
            <>
              <span className="font-medium text-foreground">{count}</span>{" "}
              {count === 1 ? "class" : "classes"} organizing your school.
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}

function ClassesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="glass rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex gap-1">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-14 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="glass rounded-xl p-6 flex items-start gap-4 border-destructive/20 animate-fade-in">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <h3 className="text-md font-semibold tracking-tight text-foreground">
          Couldn&apos;t load classes
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
          className="mt-4"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
