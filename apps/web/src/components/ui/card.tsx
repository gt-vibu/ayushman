import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ui-card ${className}`.trim()} {...props}/>;
}

export function CardHeader({ children }: { children: ReactNode }) { return <header className="ui-card-header">{children}</header>; }
export function CardContent({ children }: { children: ReactNode }) { return <div className="ui-card-content">{children}</div>; }
