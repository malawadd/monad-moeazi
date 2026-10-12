import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import {useNavigation} from '@react-navigation/native';
import {UserButton, UserCard, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import {haptics} from '../services/haptics';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userFonts} from '../theme/tokens';
import {userThemeTokens} from '../theme/userThemes';

const VALID_ADDRESS = /^0x[0-9a-f]{40}$/i;

export function UserReceiveScreen() {
  const navigation = useNavigation<any>();
  const {mode, ownerAddress} = useApp();
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const [feedback, setFeedback] = useState('');
  const address = mode === 'authenticated' && ownerAddress && VALID_ADDRESS.test(ownerAddress) ? ownerAddress : null;

  useEffect(() => { setFeedback(''); }, [address]);

  function copyAddress() {
    if (!address) return;
    try {
      Clipboard.setString(address);
      haptics.confirm();
      setFeedback('Address copied. Select Monad Testnet before sending test tokens.');
    } catch {
      haptics.reject();
      setFeedback('Could not copy the address. Select the address above and copy it.');
    }
  }

  return <UserPage theme={theme}>
    <UserButton label="Back" onPress={() => navigation.goBack()} theme={theme} secondary hint="Return to the previous screen." />
    <UserHeading kicker="WALLET · MONAD TESTNET" title={address ? 'Receive test tokens' : 'Receive unavailable'}
      copy={address ? 'Share your Mera wallet address on Monad Testnet.' : 'Sign in again to load your wallet address.'} theme={theme} />

    {address ? <>
      <UserCard theme={theme}>
        <UserText theme={theme} kind="meta">SCAN TO COPY THE ADDRESS</UserText>
        <View accessible accessibilityRole="image" accessibilityLabel="QR code for your Monad Testnet wallet address"
          style={[styles.qrFrame, {borderColor: theme.border}]}>
          <QRCode value={address} size={216} color="#000000" backgroundColor="#FFFFFF" />
        </View>
        <UserText theme={theme} kind="meta">YOUR WALLET ADDRESS</UserText>
        <Text selectable accessibilityLabel={`Selectable wallet address ${address}`}
          style={[styles.address, {color: theme.ink, backgroundColor: theme.raised, borderColor: theme.border}]}>{address}</Text>
        <UserButton label="Copy wallet address" onPress={copyAddress} theme={theme}
          hint="Copy the full Mera wallet address to the clipboard." />
        <Text accessibilityLiveRegion="polite" style={[styles.feedback, {color: theme.muted}]}>{feedback}</Text>
      </UserCard>
      <Text style={[styles.networkNote, {color: theme.muted}]}>Use Monad Testnet when sending.</Text>
    </> : <UserCard theme={theme}>
      <UserText theme={theme}>Your wallet address is unavailable. Sign in again.</UserText>
    </UserCard>}
  </UserPage>;
}

const styles = StyleSheet.create({
  qrFrame: {alignSelf: 'center', width: 244, minHeight: 244, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', borderWidth: 3, padding: 11},
  address: {width: '100%', borderWidth: 2, padding: 12, fontFamily: userFonts.mono, fontSize: 14, lineHeight: 23,
    fontWeight: '700', textAlign: 'center', flexShrink: 1},
  feedback: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 21, fontWeight: '700', minHeight: 21},
  networkNote: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 21, fontWeight: '700'},
});
