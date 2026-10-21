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
import type { Branch, Practice, Service, Session, StaffMember } from '@/lib/types';

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
  session: Session;
};

export function SetupAssistant({ practice, branchId, branches, services, staff, session }: Props) {
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

  const ownMember = staff.find((member) => member.userId === session.user.id);
  const ownProfessionIds = ownMember?.professionalProfileIds ?? [];
  const ownProfile = ownMember?.professionalProfiles?.find((profile) =>
    ownProfessionIds.includes(profile.professionId),
  );
  const steps = [
    {
      label: 'Choose your first branch',
      done: Boolean(branchId && branches.some((branch) => branch.id === branchId)),
      href: '/branches',
      icon: Building2,
    },
    {
      label: 'Set your profession',
      done: ownProfessionIds.length > 0,
      href: '/staff',
      icon: Stethoscope,
    },
    {
      label: 'Set your availability',
      done: Boolean(
        rules?.some(
          (rule) =>
            rule.scope === 'professional_location' &&
            rule.professionalUserId === session.user.id &&
            rule.locationId === branchId &&
            ownProfessionIds.includes(rule.practiceProfessionId ?? '') &&
            rule.endMinute > rule.startMinute,
        ),
      ),
      href: '/availability',
      icon: CalendarClock,
    },
    {
      label: 'Create your first service',
      done: services.some(
        (service) =>
          service.active && (service.professionalUserIds ?? []).includes(session.user.id),
      ),
      href: '/services',
      icon: Stethoscope,
    },
    {
      label: 'Complete your profile',
      done: Boolean(ownProfile?.headline || ownProfile?.bio),
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
