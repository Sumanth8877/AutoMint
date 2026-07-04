import WhaleTrackerClient from './whale-tracker-client';
import { getNativeTokenUsdPrice } from '@/lib/services/native-price.service';

// Cache this page for 4 hours
export const revalidate = 14400;

export default async function WhaleTrackerPage() {
  const ethUsdPrice = await getNativeTokenUsdPrice('ethereum').catch(() => 2500);
  return <WhaleTrackerClient ethUsdPrice={ethUsdPrice} />;
}
