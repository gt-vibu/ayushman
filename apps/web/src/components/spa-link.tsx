'use client';

import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, MouseEvent } from 'react';

type Props = ComponentProps<typeof NextLink>;

/** Keeps ordinary same-origin links inside the App Router, including customer flows. */
export function SpaLink({ href, onClick, replace, scroll, ...props }: Props) {
  const router = useRouter();

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.currentTarget.target && event.currentTarget.target !== '_self') || event.currentTarget.hasAttribute('download')) return;
    const target = new URL(event.currentTarget.href, window.location.href);
    if (target.origin !== window.location.origin) return;
    event.preventDefault();
    const next = `${target.pathname}${target.search}${target.hash}`;
    if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    if (replace) router.replace(next, { scroll });
    else router.push(next, { scroll });
  }

  return <NextLink href={href} onClick={navigate} replace={replace} scroll={scroll} {...props} />;
}
