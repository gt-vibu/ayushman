'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  Circle,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { api, practicePath } from '@/lib/api';
import type { Branch, Practice, Service, StaffMember } from '@/lib/types';

type AvailabilityRule = {
  scope: string;
  practiceProfessionId: string | null;
  locationId: string | null;
  professionalUserId: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
};

type Props = {
  practice: Practice;
  branchId: string;
  branches: Branch[];
  services: Service[];
  staff: StaffMember[];
};

export function SetupAssistant({ practice, branchId, branches, services, staff }: Props) {
  const [rules, setRules] = useState<AvailabilityRule[] | null>(null);
  useEffect(() => {
    let active = true;
    const query = branchId ? `?locationId=${encodeURIComponent(branchId)}` : '';
    api<AvailabilityRule[]>(practicePath(practice.id, `/availability/rules${query}`))
      .then((value) => {
        if (active) setRules(value);
      })
      .catch(() => {
        if (active) setRules([]);
      });
    return () => {
      active = false;
    };
  }, [practice.id, branchId]);

  // A saved professional profile is the source of truth for this checklist
  // item. Owners can provide services too, and their role labels can differ
  // from hired practitioners even though the profile is active.
  const activeProviders = staff.filter((member) => member.status === 'active' && (member.professionalProfileIds?.length ?? 0) > 0);
  const activeBranch = branches.find((branch) => branch.id === branchId && branch.active);
  const onlineService = services.find((service) => service.active && service.onlineBookable && service.locationIds?.includes(branchId));
  const eligibleOnlineProviders = onlineService
    ? (onlineService.professionalUserIds ?? []).map((id) => staff.find((member) => member.userId === id))
      .filter((member) => member?.status === 'active' && member.professionalProfileIds?.includes(onlineService.practiceProfessionId))
    : [];
  // Availability is its own setup step. Don't make it appear incomplete just
  // because the provider profile or online service assignment is unfinished;
  // those have separate checklist steps. The saved rule must still be a valid
  // provider/profession schedule for the currently selected branch.
  const hasProviderSchedule = rules?.some((rule) =>
    rule.scope === 'professional_location' &&
    rule.locationId === branchId &&
    Boolean(rule.professionalUserId && rule.practiceProfessionId) &&
    rule.endMinute > rule.startMinute,
  ) ?? false;
  const steps = [
    {
      label: 'Choose your first branch',
      done: Boolean(activeBranch),
      href: '/branches',
      icon: Building2,
    },
    {
      label: 'Assign an active practitioner profile',
      done: activeProviders.length > 0,
      href: '/staff',
      icon: Stethoscope,
    },
    {
      label: !onlineService ? 'Add an active online-bookable service' : !eligibleOnlineProviders.length ? 'Assign a practitioner to the online service' : 'Online service is ready',
      done: Boolean(onlineService && eligibleOnlineProviders.length && activeBranch),
      href: '/services',
      icon: Stethoscope,
    },
    {
      label: 'Set provider availability',
      done: hasProviderSchedule,
      href: '/availability',
      icon: CalendarClock,
    },
    {
      label: 'Turn on online booking',
      done: practice.publicBookingEnabled,
      href: '/settings',
      icon: CalendarClock,
    },
    {
      label: 'Complete a practitioner profile',
      done: activeProviders.some((member) => member.professionalProfiles?.some((profile) => profile.headline || profile.bio)),
      href: '/staff',
      icon: UserRound,
    },
  ];
  const completedCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);

  return (
    <section className="setup-assistant" aria-labelledby="setup-assistant-title">
      <div className="setup-assistant-main">
        <p className="setup-assistant-eyebrow">
          <Sparkles size={15} /> QUICK SETUP
        </p>
        <h2 id="setup-assistant-title">
          {nextStep ? 'Let’s get your practice ready' : 'Your setup is complete'}
        </h2>
        <p>
          {nextStep
            ? `You’ve completed ${completedCount} of ${steps.length} steps. Next, ${nextStep.label.toLowerCase()}. You can finish the other steps later.`
            : 'You’ve completed the essentials. You can update these settings any time.'}
        </p>
        <div
          className="setup-assistant-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completedCount}
          aria-label="Practice setup progress"
        >
          <span style={{ width: `${(completedCount / steps.length) * 100}%` }} />
        </div>
        <small>
          {completedCount} of {steps.length} complete
        </small>
        {nextStep && (
          <Link className="button button-primary setup-assistant-cta" href={nextStep.href}>
            {nextStep.label}
            <ArrowRight size={15} />
          </Link>
        )}
      </div>
      <ol className="setup-assistant-steps">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.label}>
              <Link
                href={step.href}
                className={step.done ? 'setup-step setup-step-done' : 'setup-step'}
              >
                {step.done ? <Check size={16} /> : <Circle size={16} />}
                <Icon size={16} />
                <span>{step.label}</span>
                <ArrowRight size={14} />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
