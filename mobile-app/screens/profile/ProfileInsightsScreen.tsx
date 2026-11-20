import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CaretRight, ChartBar } from 'phosphor-react-native';
import { useProfileInsights } from '@/services/profile/useProfileInsights';
import { getInsightApplications } from '@/services/api/insights';
import { insightLabels, type InsightCounter, type InsightApplication } from '@/services/profile/insightTypes';
export function ProfileInsightsSummary() {
    const router = useRouter();
    const { data, loading, error } = useProfileInsights(30);
    return (<Pressable accessibilityRole="button" accessibilityLabel="Open Profile Insights" onPress={() => router.push('/profile-insights' as any)} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
   <View style={styles.summaryIcon}><ChartBar size={22} color="#5F4DB2" weight="duotone"/></View>
   <View style={styles.summaryCopy}>
    <Text style={styles.summaryTitle}>Profile Insights</Text>
    <Text style={styles.help}>{data?.enabled && data.views ? `${data.views.current} recruiter views in the last 30 days` : loading ? 'Loading recruiter activity…' : error ? 'View recruiter activity and try again.' : 'Recruiter activity and your next profile steps'}</Text>
   </View>
   <CaretRight size={16} color="#5F6B80" weight="bold"/>
  </Pressable>);
}
function Counter({ label, value }: {
    label: string;
    value: InsightCounter;
}) {
    return <View style={styles.card}><Text style={styles.body}>{label}</Text><Text style={styles.number}>{value.current}</Text>{value.percent_change !== null && <Text style={styles.body}>{value.percent_change > 0 ? '+' : ''}{value.percent_change}% vs previous period</Text>}{value.current === 0 && <Text style={styles.help}>Keep your profile up to date. New activity will appear as recruiters discover you.</Text>}</View>;
}
export function ProfileInsightsScreen() {
    const router = useRouter();
    const [days, setDays] = useState<7 | 30>(30);
    const { data, loading, error, refresh } = useProfileInsights(days);
    const [extra, setExtra] = useState<InsightApplication[]>([]);
    const [next, setNext] = useState<number | null | undefined>();
    const [moreBusy, setMoreBusy] = useState(false);
    const [moreError, setMoreError] = useState('');
    const nextOffset = next === undefined ? data?.applications?.next_offset : next;
    return <SafeAreaView style={styles.screen}><View style={styles.header}><Pressable onPress={() => router.back()} style={styles.icon} accessibilityRole="button" accessibilityLabel="Back"><ArrowLeft size={22} color="#0A1931"/></Pressable><Text style={styles.title}>Profile Insights</Text></View>
 <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={refresh} tintColor="#5F4DB2"/>}>
 <Text style={styles.body}>See how recruiters discover and engage with your profile.</Text>
 <View style={styles.periodControl}>{([7, 30] as const).map(period => <Pressable key={period} accessibilityRole="button" accessibilityState={{ selected: period === days }} onPress={() => { setDays(period); setExtra([]); setNext(undefined); }} style={[styles.pill, period === days && styles.active]}><Text style={[styles.periodLabel, period === days && styles.activeLabel]}>Last {period} days</Text></Pressable>)}</View>
 {loading && !data && <ActivityIndicator color="#5F4DB2" accessibilityLabel="Loading insights"/>}{!!error && <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable onPress={refresh} accessibilityRole="button"><Text style={styles.link}>Retry</Text></Pressable></View>}
 {data && !data.enabled && <Text style={styles.body}>Profile Insights is being rolled out. Keep your profile complete and check back soon.</Text>}
 {data?.enabled && <>
 <Text style={styles.help}>{data.period_start} – {data.period_end} · India time. {data.aggregated_at ? `Updated ${new Date(data.aggregated_at).toLocaleString('en-IN')}` : 'Activity summaries are preparing.'}</Text>
 {!!data.coverage_note && <Text style={styles.help}>{data.coverage_note}</Text>}
 {data.views && <Counter label="Recruiter profile views" value={data.views}/>}{data.search && <Counter label="Search appearances" value={data.search}/>}{data.actions && <Counter label="Recruiter actions" value={data.actions}/>}
 {data.search && <View style={styles.card}><Text style={styles.heading}>Top search keywords</Text>{data.keywords?.length ? data.keywords.map(item => <View key={item.keyword} style={styles.row}><Text style={[styles.body, { flex: 1 }]}>{item.keyword}</Text><Text style={styles.body}>{item.count}</Text></View>) : <Text style={styles.help}>Matched skills and locations will appear after recruiters see your profile in search.</Text>}</View>}
 {data.actions && <View style={styles.card}><Text style={styles.heading}>Recruiter actions</Text>{data.action_breakdown?.map(item => <View key={item.action} style={styles.row}><Text style={[styles.body, { flex: 1 }]}>{insightLabels[item.action] || item.action}</Text><Text style={styles.body}>{item.current}{item.percent_change === null ? '' : ` (${item.percent_change > 0 ? '+' : ''}${item.percent_change}%)`}</Text></View>)}<Text style={styles.help}>Email and call counts record link openings; they do not confirm that contact took place.</Text><Text style={styles.heading}>Companies taking action</Text>{data.companies?.length ? data.companies.map((company, index) => <View key={index} style={styles.company}><Text style={styles.label}>{company.name} · {company.actions} actions</Text><Text style={styles.help}>{company.industry || 'Industry not provided'} · {company.city || 'City not provided'}</Text></View>) : <Text style={styles.help}>Company activity will appear when a recruiter takes an action.</Text>}{data.companies_truncated && <Text style={styles.help}>Showing the 20 most active companies.</Text>}</View>}
 {data.strength && <View style={styles.card}><Text style={styles.heading}>Profile strength · {data.strength.score}% complete</Text><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: data.strength.score }} accessibilityLabel="Profile completeness" style={styles.track}><View style={[styles.fill, { width: `${data.strength.score}%` }]}/></View><Text style={styles.help}>Completeness of your profile details; separate from your Bharatpath Score.</Text>{data.strength.next_steps.map(step => <Pressable key={step.key} accessibilityRole="button" onPress={() => router.push((step.key === 'resume' ? '/resume-details' : step.key === 'photo' ? '/you' : '/profile-details') as any)}><Text style={styles.link}>{step.label}</Text><Text style={styles.body}>{step.benefit}</Text></Pressable>)}{!data.strength.next_steps.length && <Text style={styles.body}>Your profile details are complete. Keep them current.</Text>}</View>}
 {data.applications && <View style={styles.card}><Text style={styles.heading}>Application timelines</Text>{[...data.applications.items, ...extra].map(application => <View key={application.id} style={styles.company}><Pressable onPress={() => router.push({ pathname: '/application-detail', params: { id: application.id } } as any)}><Text style={styles.link}>{application.title}</Text></Pressable><Text style={styles.body}>{application.company} · {insightLabels[application.current_stage] || application.current_stage}</Text><View style={styles.timeline}>{application.timeline.map((event, index) => <Text key={index} style={styles.body}>{insightLabels[event.stage] || event.stage} · {new Date(event.at).toLocaleString('en-IN')}</Text>)}</View></View>)}{!data.applications.items.length && <Text style={styles.help}>Apply to a suitable job to start your application timeline.</Text>}{nextOffset != null && <Pressable accessibilityRole="button" disabled={moreBusy} onPress={async () => { setMoreBusy(true); setMoreError(''); try {
            const page = await getInsightApplications(nextOffset);
            setExtra(previous => [...previous, ...page.items]);
            setNext(page.next_offset);
        }
        catch {
            setMoreError('More applications could not be loaded. Please retry.');
        }
        finally {
            setMoreBusy(false);
        } }}><Text style={styles.link}>{moreBusy ? 'Loading…' : 'Load more applications'}</Text></Pressable>}{!!moreError && <Text style={styles.error}>{moreError}</Text>}</View>}
 </>}
 </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#FFFCF7' },
    header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E7E0D4' },
    icon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
    title: { flex: 1, fontFamily: 'GeneralSans-Semibold', fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#0A1931' },
    content: { padding: 20, paddingBottom: 40, gap: 16 },
    summary: { marginHorizontal: 20, padding: 16, borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 12 },
    summaryIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F1EAF7', alignItems: 'center', justifyContent: 'center' },
    summaryCopy: { flex: 1, gap: 4 },
    summaryTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, lineHeight: 20, color: '#0A1931' },
    pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
    card: { padding: 16, borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 16, backgroundColor: '#FFFFFF', gap: 12 },
    row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    heading: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, lineHeight: 22, color: '#0A1931' },
    label: { fontFamily: 'GeneralSans-Medium', fontSize: 15, lineHeight: 21, color: '#0A1931' },
    body: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#3A4761' },
    help: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 20, color: '#5F6B80' },
    number: { fontFamily: 'GeneralSans-Semibold', fontSize: 32, lineHeight: 38, letterSpacing: -0.5, color: '#0A1931' },
    link: { fontFamily: 'GeneralSans-Semibold', fontSize: 14, lineHeight: 22, color: '#5F4DB2' },
    periodControl: { flexDirection: 'row', alignSelf: 'flex-start', gap: 4, padding: 4, borderRadius: 16, backgroundColor: '#F1EAF7' },
    pill: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 12 },
    active: { backgroundColor: '#5F4DB2' },
    periodLabel: { fontFamily: 'GeneralSans-Medium', fontSize: 14, lineHeight: 20, color: '#5F4DB2' },
    activeLabel: { color: '#FFFFFF', fontFamily: 'GeneralSans-Semibold' },
    track: { height: 8, borderRadius: 4, backgroundColor: '#F1EAF7', overflow: 'hidden' },
    fill: { height: 8, backgroundColor: '#5F4DB2' },
    company: { borderTopWidth: 1, borderTopColor: '#E7E0D4', paddingTop: 12, gap: 4 },
    timeline: { borderLeftWidth: 2, borderLeftColor: '#D9D0EE', paddingLeft: 12, gap: 8, marginTop: 8 },
    error: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#993A22' },
});
