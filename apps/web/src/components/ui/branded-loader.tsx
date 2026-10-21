'use client';

import { Leaf } from 'lucide-react';

export function BrandLoader({ label = 'Loading…' }: { label?: string }) {
  return <div className="brand-loader" role="status"><span className="brand-loader-mark" aria-hidden="true"><span className="brand-loader-orbit brand-loader-orbit-one"/><span className="brand-loader-orbit brand-loader-orbit-two"/><Leaf size={19}/></span><span>{label}</span></div>;
}
