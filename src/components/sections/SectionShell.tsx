import type { ReactNode } from 'react';

interface SectionShellProps {
  id: string;
  title: string;
  icon?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}

/** Common wrapper for every section of the single-page health view. */
export default function SectionShell({ id, title, icon, center, right, children }: SectionShellProps) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h2 className="text-sm font-bold text-primary tracking-wide">{title}</h2>
        </div>
        {center && <div className="justify-self-center">{center}</div>}
        {right && <div className="justify-self-end col-start-3">{right}</div>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {children}
      </div>
    </section>
  );
}
