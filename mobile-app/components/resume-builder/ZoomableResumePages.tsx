import React, { useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Minus, Plus, CornersOut } from 'phosphor-react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

export function ZoomableResumePages({ pages, mime = 'image/png', truncated = false }: { pages: string[]; mime?: string; truncated?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const pinchStart = useRef(1);
  const updateZoom = (value: number) => {
    const next = Math.max(0.5, Math.min(3, value));
    zoomRef.current = next;
    setZoom(next);
  };
  const pinch = useMemo(() => Gesture.Pinch().runOnJS(true)
    .onStart(() => { pinchStart.current = zoomRef.current; })
    .onUpdate(event => {
      if (Number.isFinite(event.scale) && event.scale > 0) {
        const next = Math.max(0.5, Math.min(3, pinchStart.current * event.scale));
        zoomRef.current = next;
        setZoom(next);
      }
    }), []);
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const pageWidth = Math.max(1, width - 24) * zoom;
  return <GestureHandlerRootView style={styles.root} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" disabled={zoom <= 0.5} onPress={() => updateZoom(zoomRef.current - 0.25)} style={styles.control}><Minus size={20} color={zoom <= 0.5 ? '#A0A7B2' : '#5F4DB2'}/></Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.label}>{Math.round(zoom * 100)}%</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" disabled={zoom >= 3} onPress={() => updateZoom(zoomRef.current + 0.25)} style={styles.control}><Plus size={20} color={zoom >= 3 ? '#A0A7B2' : '#5F4DB2'}/></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Fit resume to width" onPress={() => updateZoom(1)} style={[styles.control, styles.fit]}><CornersOut size={18} color="#5F4DB2"/><Text style={styles.label}>Fit</Text></Pressable>
    </View>
    <GestureDetector gesture={pinch}>
    <View collapsable={false} style={styles.root}>
    <ScrollView horizontal nestedScrollEnabled pinchGestureEnabled={false} style={styles.viewport} contentContainerStyle={{ minWidth: '100%' }}>
      <ScrollView nestedScrollEnabled style={{ width: Math.max(width, pageWidth + 24) }} contentContainerStyle={styles.pages}>
        {pages.map((page, index) => <View key={index} style={{ width: pageWidth, gap: 8 }}><Text style={styles.caption}>Page {index + 1} of {pages.length}{truncated ? '+' : ''}</Text><Image accessibilityLabel={`Resume page ${index + 1}`} source={{ uri: `data:${mime};base64,${page}` }} style={{ width: pageWidth, aspectRatio: 210 / 297, backgroundColor: '#FFFFFF' }} resizeMode="contain"/></View>)}
        {truncated && <Text style={[styles.caption, { width: Math.max(1, width - 24) }]}>The preview shows the first pages. Download the full resume to review all pages.</Text>}
      </ScrollView>
    </ScrollView>
    </View>
    </GestureDetector>
  </GestureHandlerRootView>;
}
const styles = StyleSheet.create({ root: { flex: 1, minHeight: 0 }, toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#E7E0D4', backgroundColor: '#FFFCF7' }, control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, fit: { flexDirection: 'row', gap: 6, marginLeft: 'auto', paddingHorizontal: 8 }, label: { fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#5F4DB2' }, caption: { fontFamily: 'GeneralSans-Regular', fontSize: 12, lineHeight: 18, color: '#5F6B80' }, viewport: { flex: 1, backgroundColor: '#F1EEE8' }, pages: { padding: 12, gap: 18, alignItems: 'center' } });
