import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, PanResponder, StyleSheet, Text, View} from 'react-native';
import {border, colors, spacing, type} from '../theme/tokens';
import {useReducedMotion} from './Motion';

const HANDLE_SIZE = 54;
const TRACK_PADDING = 4;
const CONFIRM_THRESHOLD = 0.85;

export function shouldConfirmSlide(position: number, availableTravel: number) {
  return availableTravel > 0 && position >= availableTravel * CONFIRM_THRESHOLD;
}

export function SlideToConfirm({onConfirm, onProgress, disabled = false}: {
  onConfirm: () => Promise<void>;
  onProgress?: (progress: number) => void;
  disabled?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const position = useRef(new Animated.Value(0)).current;
  const positionValue = useRef(0);
  const gestureStart = useRef(0);
  const travel = useRef(0);
  const committing = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const listener = position.addListener(({value}) => {
      positionValue.current = value;
      onProgress?.(travel.current > 0 ? Math.max(0, Math.min(1, value / travel.current)) : 0);
    });
    return () => position.removeListener(listener);
  }, [onProgress, position]);

  const settle = (target: number) => {
    position.stopAnimation();
    if (reducedMotion) return position.setValue(target);
    Animated.spring(position, {
      toValue: target,
      stiffness: 210,
      damping: 24,
      mass: 1,
      overshootClamping: true,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
      useNativeDriver: true,
    }).start();
  };

  const commit = async () => {
    if (disabled || committing.current || travel.current <= 0) return;
    committing.current = true;
    setBusy(true);
    settle(travel.current);
    try {
      await onConfirm();
    } catch {
      settle(0);
    } finally {
      committing.current = false;
      setBusy(false);
    }
  };

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !disabled
      && !committing.current
      && Math.abs(gesture.dx) > 8
      && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => {
      position.stopAnimation(value => {
        positionValue.current = value;
        gestureStart.current = value;
      });
    },
    onPanResponderMove: (_event, gesture) => {
      const next = Math.max(0, Math.min(travel.current, gestureStart.current + gesture.dx));
      position.setValue(next);
    },
    onPanResponderRelease: () => {
      if (shouldConfirmSlide(positionValue.current, travel.current)) commit().catch(() => undefined);
      else settle(0);
    },
    onPanResponderTerminate: () => settle(0),
    onPanResponderTerminationRequest: () => true,
  // Animated values and refs are stable for the lifetime of the control.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [disabled, reducedMotion]);

  return <View
    accessible
    accessibilityRole="button"
    accessibilityLabel="Slide right to confirm safe USDC sending"
    accessibilityHint="Swipe the handle right, or double tap to confirm"
    accessibilityState={{disabled, busy}}
    accessibilityActions={[{name: 'activate', label: 'Confirm safe sending'}]}
    onAccessibilityAction={event => {
      if (event.nativeEvent.actionName === 'activate') commit().catch(() => undefined);
    }}
    onAccessibilityTap={() => commit().catch(() => undefined)}
    onLayout={event => {
      travel.current = Math.max(0, event.nativeEvent.layout.width - HANDLE_SIZE - TRACK_PADDING * 2);
      onProgress?.(travel.current > 0 ? positionValue.current / travel.current : 0);
      if (committing.current) position.setValue(travel.current);
    }}
    style={[styles.track, disabled && styles.disabled]}
    {...responder.panHandlers}>
    <Text importantForAccessibility="no" style={styles.label}>{busy ? 'SAVING…' : 'SLIDE TO CONFIRM'}</Text>
    <Animated.View importantForAccessibility="no-hide-descendants" style={[styles.handle, {transform: [{translateX: position}]}]}>
      <Text style={styles.arrow}>→</Text>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  track: {
    height: 64,
    borderWidth: border.nested,
    borderColor: colors.ink,
    backgroundColor: colors.cream,
    justifyContent: 'center',
    padding: TRACK_PADDING,
    overflow: 'hidden',
  },
  disabled: {opacity: 0.55},
  label: {
    ...type.meta,
    position: 'absolute',
    alignSelf: 'center',
    color: colors.ink,
    fontSize: 12,
    letterSpacing: 1.3,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderWidth: border.nested,
    borderColor: colors.ink,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOffset: {width: 3, height: 3},
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  arrow: {...type.body, color: colors.ink, fontSize: 24, lineHeight: 28, marginRight: spacing.xs},
});
