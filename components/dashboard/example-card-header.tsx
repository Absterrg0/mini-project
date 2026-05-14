import { BookOpen } from "lucide-react";

/** Tags that read as stack / runner (shown beside title). */
const FRAMEWORK_TAGS = new Set(["jest", "playwright", "vitest", "npm", "docker"]);

function splitExampleTags(tags: readonly string[]) {
  const framework = tags.filter((t) => FRAMEWORK_TAGS.has(t));
  const category = tags.filter((t) => !FRAMEWORK_TAGS.has(t));
  return { framework, category };
}

type ExampleCardHeaderProps = {
  title: string;
  description: string;
  filename: string;
  tags: readonly string[];
  tagClassName: (t: string) => string;
};

export function ExampleCardHeader({ title, description, filename, tags, tagClassName }: ExampleCardHeaderProps) {
  const { framework, category } = splitExampleTags(tags);

  return (
    <div className="px-5 py-4 border-b border-white/[0.06]">
      <div className="space-y-2.5 min-w-0">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
              {framework.map((t) => (
                <span
                  key={t}
                  className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium border ${tagClassName(t)}`}
                >
                  {t}
                </span>
              ))}
              {category.map((t) => (
                <span
                  key={t}
                  className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium border ${tagClassName(t)}`}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 w-full justify-end sm:w-auto sm:max-w-[min(50%,36rem)] sm:shrink-0">
            <span className="inline-flex max-w-full min-w-0 flex-wrap items-start justify-end gap-x-1 gap-y-0.5 border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-muted-foreground sm:max-w-[min(100%,36rem)]">
              <BookOpen size={9} className="mt-0.5 shrink-0" aria-hidden />
              <span className="max-w-full min-w-0 whitespace-normal break-all text-right" title={filename}>
                {filename}
              </span>
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed min-w-0">{description}</p>
      </div>
    </div>
  );
}
