import React, {useEffect, useState} from 'react';
import {Text} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {StackActions, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, FlowScreen, LoadingBlock, Notice, PageHeader, StatusBadge, StepRow} from '../components/Ui';
import {SlideToConfirm} from '../components/SlideToConfirm';
import {screenStyles as s} from '../theme/screenStyles';
import {colors} from '../theme/tokens';
import {useApp} from '../state/AppContext';
import {acceptFundingGuide, hasAcceptedFundingGuide} from '../services/fundingGuide';
import {haptics} from '../services/haptics';
import {fundingGuideChecks} from '../services/fundingPresentation';

export function FundingGuideScreen() {
  const {ownerAddress, mode} = useApp();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const depositAddress = String(route.params?.depositAddress ?? ownerAddress ?? '');
  const [accepted, setAccepted] = useState<boolean | null>(mode === 'preview' ? true : null);
  const [error, setError] = useState('');
  const [slideProgress, setSlideProgress] = useState(0);
  const checks = fundingGuideChecks(slideProgress, accepted === true);

  useEffect(() => {
    if (mode === 'preview') return setAccepted(true);
    if (!ownerAddress) return setAccepted(false);
    let active = true;
    hasAcceptedFundingGuide(ownerAddress)
      .then(value => { if (active) setAccepted(value); })
      .catch(() => { if (active) setAccepted(false); });
    return () => { active = false; };
  }, [mode, ownerAddress]);

  const confirm = async () => {
    setError('');
    try {
      if (!ownerAddress) throw new Error('Your Magic wallet is not ready.');
      await acceptFundingGuide(ownerAddress);
      setAccepted(true);
      haptics.confirm();
    } catch (reason) {
      haptics.reject();
      setError(reason instanceof Error ? reason.message : 'Confirmation could not be saved.');
      throw reason;
    }
  };

  const copyAndClose = () => {
    if (!accepted || !/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) return;
    Clipboard.setString(depositAddress);
    haptics.confirm();
    navigation.dispatch(StackActions.popTo('Funding', {fundingGuideResult: 'copied'}));
  };

  return <FlowScreen modal>
    <PageHeader kicker="Safe sending" title="USDC on Arbitrum" />
    {error ? <Notice live tone="rose" title="Could not save confirmation" message={error} actionLabel="Try again" onAction={() => setError('')} /> : null}
    <Card tint={colors.orangeTint}>
      <StepRow checked={checks[0]} compact number="01" title="Choose canonical USDC" detail="Select USDC in the sending wallet." />
      <StepRow checked={checks[1]} compact number="02" title="Select Arbitrum" detail="Do not use Ethereum, Base, or another network." />
      <StepRow checked={checks[2]} compact number="03" title="Verify the destination" detail="Transfers cannot be reversed after sending." />
    </Card>
    <Text style={s.body}>Sliding confirms that you understand this address is for USDC using Arbitrum. It does not approve AI trading or move funds.</Text>
    {accepted === null ? <LoadingBlock label="Checking confirmation" lines={1} /> : accepted ? <>
      <StatusBadge label="Confirmed on this device" tone="mint" />
      <Button size="hero" label="Copy USDC address" onPress={copyAndClose} />
    </> : <SlideToConfirm onConfirm={confirm} onProgress={setSlideProgress} />}
  </FlowScreen>;
}
