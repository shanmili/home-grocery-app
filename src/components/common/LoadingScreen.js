import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StatusBar, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';

export default function LoadingScreen({ message, compact = false }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {});
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, {
        toValue: 1, duration: 480, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        isInteraction: false,
      }),
      Animated.timing(progress, {
        toValue: 0, duration: 480, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        isInteraction: false,
      }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-5, 7] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['-5deg', '3deg'] });

  return (
    <View style={compact ? styles.inline : styles.screen}>
      {!compact ? <StatusBar barStyle="dark-content" /> : null}
      <View style={[styles.badge, compact && styles.inlineBadge]} importantForAccessibility="no-hide-descendants">
        <View style={styles.trail} />
        <View style={[styles.trail, styles.lowerTrail]} />
        <Animated.View style={[styles.cart, { transform: [{ translateX }, { translateY }, { rotate }] }]}>
          <View style={styles.handle} />
          <View style={styles.basket}>
            <View style={styles.basketLine} />
            <View style={styles.basketLine} />
          </View>
          <View style={styles.wheels}>
            <View style={styles.wheel} />
            <View style={styles.wheel} />
          </View>
        </Animated.View>
      </View>
      {!compact ? <Text style={styles.title}>Home Grocery</Text> : null}
      <Text accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.message}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.background, padding: 24,
  },
  inline: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  inlineBadge: { width: 88, height: 54, marginBottom: 0, borderRadius: 14 },
  badge: {
    width: 112, height: 92, borderRadius: 26, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  cart: { width: 58, height: 46, left: 6 },
  handle: { width: 15, height: 3, backgroundColor: colors.primaryDark, borderRadius: 2, marginBottom: 2 },
  basket: {
    width: 42, height: 24, marginLeft: 9, borderWidth: 2, borderRadius: 6,
    borderColor: colors.primaryDark, justifyContent: 'space-evenly', paddingHorizontal: 5,
  },
  basketLine: { height: 1, backgroundColor: colors.primary },
  wheels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginHorizontal: 12 },
  wheel: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primaryDark },
  trail: { position: 'absolute', left: 10, top: 35, width: 12, height: 2, borderRadius: 2, backgroundColor: colors.primary },
  lowerTrail: { left: 14, top: 44, width: 7 },
  title: { ...typography.title, color: colors.textPrimary },
  message: { ...typography.body, color: colors.textSecondary, marginTop: 5, textAlign: 'center' },
});
