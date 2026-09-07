import { HomeWorkbooksList } from '../_components/HomeWorkbooksList';
import { listDeletedWorkbooks, listWorkbooksOverview } from '../actions';

export default async function SheetsPage() {
  const [overview, deleted] = await Promise.all([listWorkbooksOverview(), listDeletedWorkbooks()]);

  return <HomeWorkbooksList overview={overview} deleted={deleted} />;
}
