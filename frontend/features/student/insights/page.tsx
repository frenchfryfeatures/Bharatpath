"use client";
import Link from 'next/link';
import { useState } from 'react';
import { BarChart3, Search, ChevronRight, ArrowLeft } from 'lucide-react';
import { PillButton } from '@/features/student/onboarding/components/ui';
import { StudentCard as Card, interactiveCardClass } from '@/features/student/components';
import { StudentPage } from '@/features/student/shell';
import { getApiErrorMessage } from '@/lib/api/error-message';
import { useProfileInsightsQuery, useLazyInsightApplicationsQuery } from './api';
import { insightLabels, type InsightCounter, type InsightApplication } from './types';
function Counter({ label, value }: {
    label: string;
    value: InsightCounter;
}) {
    return <Card className="p-5"><h2 className="text-sm text-[#5F6B80]">{label}</h2><p className="mt-2 text-3xl font-semibold text-[#0A1931]">{value.current}</p>{value.percent_change !== null && <p className="mt-1 text-sm text-[#5F6B80]">{value.percent_change > 0 ? '+' : ''}{value.percent_change}% vs previous period</p>}{value.current === 0 && <p className="mt-2 text-sm text-[#5F6B80]">Keep your profile up to date. New activity will appear here as recruiters discover you.</p>}</Card>;
}
export function ProfileInsightsCard() {
    const query = useProfileInsightsQuery(30, { refetchOnMountOrArgChange: 60 });
    return <Link href="/student/profile/insights" className={`flex items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4 text-[#0A1931] ${interactiveCardClass}`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#F1EAF7] text-[#5F4DB2]"><BarChart3 size={20} aria-hidden="true"/></span><span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold leading-5">Profile Insights</span><span className="mt-1 block text-[13px] leading-5 text-[#5F6B80]">{query.data?.enabled && query.data.views ? `${query.data.views.current} recruiter views in the last 30 days` : query.isLoading ? 'Loading recruiter activity…' : 'Recruiter activity and your next profile steps'}</span></span><ChevronRight size={17} className="shrink-0 text-[#7B8495]" aria-hidden="true"/></Link>;
}
export function ProfileInsightsPage() {
    const [days, setDays] = useState<7 | 30>(30);
    const query = useProfileInsightsQuery(days, { refetchOnMountOrArgChange: true });
    const [loadMore, moreState] = useLazyInsightApplicationsQuery();
    const [extra, setExtra] = useState<InsightApplication[]>([]);
    const [next, setNext] = useState<number | null | undefined>();
    const [pageError, setPageError] = useState('');
    const data = query.currentData;
    const nextOffset = next === undefined ? data?.applications?.next_offset : next;
    return <StudentPage><div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
 <Link href="/student/profile" className="flex w-fit items-center gap-2 rounded-xl text-sm font-medium text-[#5F4DB2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"><ArrowLeft size={16} aria-hidden="true"/>Back to profile</Link><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.3px] text-[#0A1931]">Profile Insights</h1><p className="mt-2 text-[14px] leading-[21px] text-[#5F6B80]">See how recruiters discover and engage with your profile.</p></div><div className="flex gap-1 rounded-2xl bg-[#F1EAF7] p-1">{([7, 30] as const).map(period => <button key={period} type="button" aria-pressed={days === period} onClick={() => { setDays(period); setExtra([]); setNext(undefined); }} className={`min-h-11 rounded-xl px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30 ${days === period ? 'bg-[#5F4DB2] text-white' : 'text-[#5F4DB2] hover:bg-white/60'}`}>Last {period} days</button>)}</div></div>
 {query.isFetching && <p role="status" className="text-sm text-[#5F6B80]">{data ? 'Refreshing activity…' : 'Loading insights…'}</p>}
 {query.isError && <Card className="p-4"><p role="alert">{getApiErrorMessage(query.error, 'Insights could not be loaded.')}</p><PillButton onClick={() => void query.refetch()}>Retry</PillButton></Card>}
 {data && !data.enabled && <Card className="p-5">Profile Insights is being rolled out. Keep your profile complete and check back soon.</Card>}
 {data?.enabled && <>
 <p className="text-sm text-[#5F6B80]">{data.period_start} – {data.period_end} · India time. {data.aggregated_at ? `Updated ${new Date(data.aggregated_at).toLocaleString('en-IN')}` : 'Activity summaries are preparing.'}</p>
 {data.coverage_note && <p className="text-xs text-[#5F6B80]">{data.coverage_note}</p>}
 <div className="grid gap-4 md:grid-cols-3">{data.views && <Counter label="Recruiter profile views" value={data.views}/>}{data.search && <Counter label="Search appearances" value={data.search}/>}{data.actions && <Counter label="Recruiter actions" value={data.actions}/>}</div>
 {data.search && <Card className="p-5"><h2 className="flex items-center gap-2 font-semibold"><Search size={18}/>Top search keywords</h2>{data.keywords?.length ? <ul className="mt-3 flex flex-wrap gap-2">{data.keywords.map(item => <li key={item.keyword} className="rounded-full bg-[#F1EAF7] px-3 py-2 text-sm">{item.keyword} · {item.count}</li>)}</ul> : <p className="mt-2 text-sm text-[#5F6B80]">Matched skills and locations will appear after recruiters see your profile in search.</p>}</Card>}
 {data.actions && <Card className="p-5"><h2 className="font-semibold">Recruiter actions</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{data.action_breakdown?.map(item => <div key={item.action} className="flex justify-between gap-4 text-sm"><span>{insightLabels[item.action] || item.action}</span><span>{item.current}{item.percent_change === null ? '' : ` (${item.percent_change > 0 ? '+' : ''}${item.percent_change}%)`}</span></div>)}</div><p className="mt-3 text-xs text-[#5F6B80]">Email and call counts record link openings; they do not confirm that contact took place.</p><h3 className="mt-5 font-semibold">Companies taking action</h3>{data.companies?.length ? <ul className="mt-2 divide-y divide-[#E7E0D4]">{data.companies.map((company, index) => <li key={index} className="py-3 text-sm"><p className="font-medium">{company.name} · {company.actions} actions</p><p className="text-[#5F6B80]">{company.industry || 'Industry not provided'} · {company.city || 'City not provided'}</p></li>)}</ul> : <p className="mt-2 text-sm text-[#5F6B80]">Company activity will appear here when a recruiter takes an action.</p>}{data.companies_truncated && <p className="text-sm">Showing the 20 most active companies.</p>}</Card>}
 {data.strength && <Card className="p-5"><h2 className="font-semibold">Profile strength · {data.strength.score}% complete</h2><div role="progressbar" aria-label="Profile completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.strength.score} className="mt-3 h-2 overflow-hidden rounded-full bg-[#F1EAF7]"><div className="h-full rounded-full bg-[#5F4DB2]" style={{ width: `${data.strength.score}%` }}/></div><p className="mt-2 text-xs text-[#5F6B80]">Completeness of your profile details; separate from your Bharatpath Score.</p><ul className="mt-3 space-y-3">{data.strength.next_steps.map(step => <li key={step.key}><Link href={step.key === 'resume' ? '/student/profile/resume' : '/student/profile'} className="text-sm font-semibold text-[#5F4DB2]">{step.label}</Link><p className="text-sm text-[#5F6B80]">{step.benefit}</p></li>)}</ul>{!data.strength.next_steps.length && <p className="mt-3 text-sm">Your profile details are complete. Keep them current.</p>}</Card>}
 {data.applications && <Card className="p-5"><h2 className="font-semibold">Application timelines</h2>{[...data.applications.items, ...extra].map(application => <section key={application.id} className="mt-4 border-t border-[#E7E0D4] pt-4"><Link href={`/student/board/${application.id}`} className="font-medium text-[#5F4DB2]">{application.title}</Link><p className="text-sm text-[#5F6B80]">{application.company} · {insightLabels[application.current_stage] || application.current_stage}</p><ol className="mt-3 space-y-2 border-l border-[#D9D0EE] pl-4">{application.timeline.map((event, index) => <li key={index} className="text-sm">{insightLabels[event.stage] || event.stage} <time className="ml-2 text-xs text-[#5F6B80]">{new Date(event.at).toLocaleString('en-IN')}</time></li>)}</ol></section>)}{!data.applications.items.length && <p className="mt-2 text-sm text-[#5F6B80]">Apply to a suitable job to start your application timeline.</p>}{nextOffset != null && <PillButton disabled={moreState.isFetching} onClick={async () => { try {
            setPageError('');
            const page = await loadMore(nextOffset).unwrap();
            setExtra(previous => [...previous, ...page.items]);
            setNext(page.next_offset);
        }
        catch {
            setPageError('More applications could not be loaded. Please retry.');
        } }}>Load more applications</PillButton>}{pageError && <p role="alert">{pageError}</p>}</Card>}
 </>}
 </div></StudentPage>;
}
