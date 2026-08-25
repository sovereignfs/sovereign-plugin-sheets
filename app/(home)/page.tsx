import { HomeWorkbooksList } from '../_components/HomeWorkbooksList';
import { listWorkbooksOverview } from '../actions';

export default async function SheetsPage() {
  const overview = await listWorkbooksOverview();

  return <HomeWorkbooksList overview={overview} />;
}
