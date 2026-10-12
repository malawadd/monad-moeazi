import React, {PropsWithChildren, useRef} from 'react';
import {ActivityIndicator, Animated, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, useWindowDimensions, View, ViewStyle} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {border, colors, motion, spacing, type} from '../theme/tokens';
import {useReducedMotion} from './Motion';
import {isMonadTransactionHash, MonadTransactionHash} from './MonadTransactionHash';

type Tone = 'paper' | 'sky' | 'mint' | 'orange' | 'lilac' | 'rose' | 'yellow';
const toneColor: Record<Tone, string> = {paper: colors.cream, sky: colors.sky, mint: colors.mint, orange: colors.orange, lilac: colors.lilac, rose: colors.rose, yellow: colors.yellow};

export function Screen({children, scroll = true, onBack, backLabel = 'Back', refreshing = false, onRefresh}: PropsWithChildren<{scroll?: boolean; onBack?: () => void; backLabel?: 'Back' | 'Close'; refreshing?: boolean; onRefresh?: () => void}>) {
  const content = <View style={styles.page}>{onBack ? <Pressable accessibilityRole="button" accessibilityLabel={backLabel === 'Close' ? 'Close' : 'Go back'} hitSlop={8} onPress={onBack} style={({pressed}) => [styles.backButton, pressed && styles.backPressed]}>{backLabel === 'Back' ? <Text style={styles.backArrow}>←</Text> : null}<Text style={styles.backText}>{backLabel}</Text></Pressable> : null}{children}</View>;
  const refresh = onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.ink]} progressBackgroundColor={colors.yellow} /> : undefined;
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>{scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} refreshControl={refresh}>{content}</ScrollView> : content}</SafeAreaView>;
}

export function FlowScreen({children, scroll = true, modal = false, refreshing = false, onRefresh}: PropsWithChildren<{scroll?: boolean; modal?: boolean; refreshing?: boolean; onRefresh?: () => void}>) {
  const navigation = useNavigation();
  return <Screen scroll={scroll} onBack={() => navigation.goBack()} backLabel={modal ? 'Close' : 'Back'} refreshing={refreshing} onRefresh={onRefresh}>{children}</Screen>;
}

export function Kicker({children, tone = 'paper'}: PropsWithChildren<{tone?: Tone}>) {
  return <Text style={[styles.kicker, {backgroundColor: toneColor[tone]}]}>{children}</Text>;
}

export function PageHeader({kicker, title, copy}: {kicker: string; title: string; copy?: string}) {
  return <View style={styles.header}><Kicker>{kicker}</Kicker><Text accessibilityRole="header" style={styles.title}>{title}</Text>{copy ? <Text style={styles.copy}>{copy}</Text> : null}</View>;
}

export function Panel({children, tone = 'paper', style, bodyStyle}: PropsWithChildren<{tone?: Tone; style?: StyleProp<ViewStyle>; bodyStyle?: StyleProp<ViewStyle>}>) {
  return <View style={[styles.panel, style]}><View style={[styles.strip, {backgroundColor: toneColor[tone]}]} /><View style={[styles.panelBody, bodyStyle]}>{children}</View></View>;
}

export function Card({children, tint = colors.paperAlt}: PropsWithChildren<{tint?: string}>) {
  return <View style={[styles.card, {backgroundColor: tint}]}>{children}</View>;
}

export function Section({children, style}: PropsWithChildren<{style?: StyleProp<ViewStyle>}>) {
  return <View style={[styles.section, style]}>{children}</View>;
}

export function DisclosureRow({label, meta, expanded, onPress, tint = colors.paper}: {label: string; meta: string; expanded: boolean; onPress: () => void; tint?: string}) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${label}, ${meta}`}
    accessibilityState={{expanded}}
    onPress={onPress}
    style={({pressed}) => [styles.disclosure, {backgroundColor: tint}, pressed && styles.disclosurePressed]}>
    <View style={styles.disclosureCopy}><Text style={styles.disclosureLabel}>{label}</Text><Text style={styles.disclosureMeta}>{meta}</Text></View>
    <Text importantForAccessibility="no" style={styles.disclosureMark}>{expanded ? '−' : '+'}</Text>
  </Pressable>;
}

export function ActionRow({children, onPress, label, tint = colors.paper}: PropsWithChildren<{onPress: () => void; label: string; tint?: string}>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({pressed}) => [styles.actionRow, {backgroundColor: tint}, pressed && styles.actionRowPressed]}>{children}</Pressable>;
}

export function Button({label, onPress, variant = 'primary', size = 'default', disabled, loading, hint}: {label: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'danger'; size?: 'default' | 'hero'; disabled?: boolean; loading?: boolean; hint?: string}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const backgroundColor = variant === 'danger' ? colors.red : variant === 'primary' ? colors.yellow : colors.paper;
  const animate = (toValue: number) => reduced ? progress.setValue(toValue) : Animated.timing(progress, {toValue, duration: motion.press, useNativeDriver: true}).start();
  return <Animated.View style={{transform: [{translateX: progress.interpolate({inputRange: [0, 1], outputRange: [0, 3]})}, {translateY: progress.interpolate({inputRange: [0, 1], outputRange: [0, 3]})}]}}><Pressable accessibilityRole="button" accessibilityHint={hint} accessibilityState={{disabled: Boolean(disabled || loading), busy: Boolean(loading)}} disabled={disabled || loading} onPress={onPress} onPressIn={() => animate(1)} onPressOut={() => animate(0)} style={({pressed}) => [styles.button, size === 'hero' && styles.heroButton, {backgroundColor}, pressed && styles.pressed, (disabled || loading) && styles.disabled]}>{loading ? <ActivityIndicator color={colors.ink} /> : <Text style={[styles.buttonText, size === 'hero' && styles.heroButtonText, variant === 'danger' && styles.white]}>{label}</Text>}</Pressable></Animated.View>;
}

export function TextLink({label, onPress}: {label: string; onPress: () => void}) {
  return <Pressable accessibilityRole="link" onPress={onPress} style={styles.link}><Text style={styles.linkText}>{label} →</Text></Pressable>;
}

export function Field(props: TextInputProps & {label: string}) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{props.label}</Text><TextInput accessibilityLabel={props.accessibilityLabel ?? props.label} {...props} placeholderTextColor={colors.muted} style={[styles.input, props.style]} /></View>;
}

export function DataRow({label, value}: {label: string; value: string}) {
  const {fontScale} = useWindowDimensions();
  const stacked = fontScale >= 1.5;
  const transactionHash = isMonadTransactionHash(value) && /^(transaction(?: hash)?|tx(?: hash)?)$/i.test(label.trim());
  return <View style={[styles.dataRow, stacked && styles.dataRowStacked]}><Text style={styles.dataLabel}>{label}</Text>
    {transactionHash ? <MonadTransactionHash hash={value} style={[styles.dataValue, stacked && styles.dataValueStacked, {textDecorationLine: 'underline'}]} />
      : <Text style={[styles.dataValue, stacked && styles.dataValueStacked]}>{value}</Text>}</View>;
}

export function StatusBadge({label, tone = 'paper'}: {label: string; tone?: Tone}) {
  return <Text style={[styles.badge, {backgroundColor: toneColor[tone]}]}>{label}</Text>;
}

export function Notice({title, message, tone = 'sky', actionLabel, onAction, live = false}: {title: string; message?: string; tone?: Tone; actionLabel?: string; onAction?: () => void; live?: boolean}) {
  return <View accessibilityRole={live ? 'alert' : undefined} style={[styles.notice, {backgroundColor: toneColor[tone]}]}><View style={styles.noticeCopy}><Text style={styles.noticeTitle}>{title}</Text>{message ? <Text style={styles.noticeMessage}>{message}</Text> : null}</View>{actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={styles.noticeAction}><Text style={styles.noticeActionText}>{actionLabel}</Text></Pressable> : null}</View>;
}

export function LoadingBlock({label, lines = 2}: {label: string; lines?: number}) {
  return <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}><Text style={styles.loadingLabel}>{label}</Text>{Array.from({length: lines}).map((_, index) => <View key={index} style={[styles.loadingLine, index === lines - 1 && styles.loadingLineShort]} />)}</View>;
}

export function StepRow({number, title, detail, active = false, complete = false, checked = false, compact = false}: {number: string; title: string; detail?: string; active?: boolean; complete?: boolean; checked?: boolean; compact?: boolean}) {
  return <View style={[styles.stepRow, compact && styles.stepCompact, active && styles.stepActive, checked && styles.stepChecked]}><Text style={styles.stepNumber}>{number}</Text><View style={styles.stepCopy}><Text style={styles.stepTitle}>{title}</Text>{detail ? <Text style={styles.stepDetail}>{detail}</Text> : null}</View><Text style={styles.stepState}>{checked ? 'CHECKED' : active ? 'NOW' : complete ? 'DONE' : ''}</Text></View>;
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.paper}, scroll: {flexGrow: 1}, page: {flex: 1, padding: spacing.md, gap: spacing.md, paddingBottom: 34},
  backButton: {minHeight: 48, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: border.nested, borderColor: colors.ink, backgroundColor: colors.yellow, paddingHorizontal: 12, paddingVertical: 8}, backPressed: {backgroundColor: colors.cream}, backArrow: {...type.body, color: colors.ink, fontSize: 22, lineHeight: 24}, backText: {...type.meta, color: colors.ink, fontSize: 12, textTransform: 'uppercase'},
  header: {gap: spacing.sm}, title: {...type.display, color: colors.ink, fontSize: 38, lineHeight: 39, letterSpacing: -1.4}, copy: {...type.body, color: colors.muted, fontSize: 16, lineHeight: 24},
  kicker: {...type.meta, alignSelf: 'flex-start', borderWidth: border.nested, borderColor: colors.ink, paddingHorizontal: 9, paddingVertical: 6, color: colors.ink, fontSize: 11, textTransform: 'uppercase'},
  panel: {borderWidth: border.strong, borderColor: colors.ink, backgroundColor: colors.paper, shadowColor: colors.ink, shadowOffset: {width: 6, height: 6}, shadowOpacity: 1, shadowRadius: 0, elevation: 6}, strip: {height: 16, borderBottomWidth: border.strong, borderColor: colors.ink}, panelBody: {padding: spacing.md, gap: spacing.md},
  card: {borderWidth: border.quiet, borderColor: colors.ink, padding: spacing.md, gap: spacing.sm},
  section: {borderTopWidth: border.nested, borderColor: colors.ink, paddingTop: spacing.md, gap: spacing.sm},
  disclosure: {minHeight: 56, borderWidth: border.quiet, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 8}, disclosurePressed: {backgroundColor: colors.cream}, disclosureCopy: {flex: 1, gap: 2}, disclosureLabel: {...type.body, color: colors.ink, fontWeight: '800', fontSize: 15}, disclosureMeta: {...type.meta, color: colors.muted, fontSize: 10, textTransform: 'uppercase'}, disclosureMark: {...type.display, color: colors.ink, fontSize: 25, lineHeight: 28},
  actionRow: {minHeight: 72, borderWidth: border.nested, borderColor: colors.ink, padding: spacing.md, gap: spacing.sm, shadowColor: colors.ink, shadowOffset: {width: 3, height: 3}, shadowOpacity: 1, shadowRadius: 0, elevation: 3}, actionRowPressed: {transform: [{translateX: 2}, {translateY: 2}], shadowOffset: {width: 1, height: 1}, elevation: 1},
  button: {minHeight: 52, borderWidth: border.strong, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, shadowColor: colors.ink, shadowOffset: {width: 5, height: 5}, shadowOpacity: 1, shadowRadius: 0, elevation: 5}, heroButton: {minHeight: 72}, pressed: {transform: [{translateX: 3}, {translateY: 3}], shadowOffset: {width: 2, height: 2}, elevation: 2}, disabled: {opacity: 0.55}, buttonText: {...type.meta, color: colors.ink, fontSize: 14, textTransform: 'uppercase'}, heroButtonText: {fontSize: 17, letterSpacing: 1.4}, white: {color: colors.white},
  link: {minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start'}, linkText: {...type.body, fontWeight: '800', color: colors.ink, fontSize: 15, textDecorationLine: 'underline'},
  field: {gap: 8}, fieldLabel: {...type.body, color: colors.ink, fontWeight: '800'}, input: {...type.body, minHeight: 52, borderWidth: border.nested, borderColor: colors.ink, backgroundColor: colors.paper, padding: 12, color: colors.ink, fontSize: 16},
  dataRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 11, borderBottomWidth: 2, borderColor: colors.ink}, dataRowStacked: {flexDirection: 'column', gap: 4}, dataLabel: {...type.body, color: colors.muted, flex: 1}, dataValue: {...type.body, color: colors.ink, fontWeight: '800', flex: 1, textAlign: 'right'}, dataValueStacked: {textAlign: 'left'}, badge: {...type.meta, alignSelf: 'flex-start', borderWidth: border.nested, borderColor: colors.ink, paddingHorizontal: 9, paddingVertical: 6, color: colors.ink, fontSize: 11, textTransform: 'uppercase'},
  notice: {minHeight: 52, borderWidth: border.nested, borderColor: colors.ink, paddingHorizontal: spacing.sm, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: spacing.sm}, noticeCopy: {flex: 1, gap: 3}, noticeTitle: {...type.body, color: colors.ink, fontWeight: '800', fontSize: 14}, noticeMessage: {...type.body, color: colors.ink, fontSize: 13, lineHeight: 18}, noticeAction: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 8}, noticeActionText: {...type.meta, color: colors.ink, fontSize: 11, textDecorationLine: 'underline'},
  loading: {minHeight: 104, borderWidth: border.quiet, borderColor: colors.ink, padding: spacing.md, gap: 12, backgroundColor: colors.paperAlt}, loadingLabel: {...type.meta, color: colors.muted, fontSize: 11, textTransform: 'uppercase'}, loadingLine: {height: 12, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.ink}, loadingLineShort: {width: '64%'},
  stepRow: {minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderBottomWidth: border.quiet, borderColor: colors.ink}, stepCompact: {minHeight: 48, paddingVertical: 6}, stepActive: {backgroundColor: colors.yellow, paddingHorizontal: 10, borderWidth: border.nested}, stepChecked: {backgroundColor: colors.mint, paddingHorizontal: 10, borderWidth: border.nested}, stepNumber: {...type.meta, color: colors.ink, fontSize: 13, width: 28}, stepCopy: {flex: 1, gap: 2}, stepTitle: {...type.body, color: colors.ink, fontWeight: '800', fontSize: 15}, stepDetail: {...type.body, color: colors.muted, fontSize: 13, lineHeight: 18}, stepState: {...type.meta, color: colors.ink, fontSize: 10},
});
