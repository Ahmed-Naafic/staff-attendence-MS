/*
 * Accountant workspace (docs/mobile/workspaces.md): Home · Students · Payments · More, over the
 * existing Fee Management API. The fee screens are shared with Managers' Fee Management (their
 * workspace's API base). Payments and cash closing are online only.
 */
import { Screen, ScreenHeader } from '../../components/ui';
import CashClosingScreen from '../fees/CashClosingScreen';
import { DiscountsScreen, FeeReportScreen, FeeReportsScreen, FeeStructuresScreen, InvoiceDetailScreen, InvoicesScreen, PaymentDetailScreen } from '../fees/FeeDetailScreens';
import FeeHomeScreen from '../fees/FeeHomeScreen';
import FeeStudentScreen from '../fees/FeeStudentScreen';
import FeeStudentsScreen from '../fees/FeeStudentsScreen';
import PaymentsScreen, { ReceiptsScreen } from '../fees/PaymentsScreen';
import RecordPaymentScreen from '../fees/RecordPaymentScreen';
import MoreScreen from '../more/MoreScreen';

export const accountantTabs = [
  { name: 'FeeHome', label: 'Home', component: FeeHomeScreen, icon: 'home' },
  { name: 'FeeStudentsTab', label: 'Students', component: FeeStudentsScreen, icon: 'people' },
  { name: 'PaymentsTab', label: 'Payments', component: PaymentsScreen, icon: 'cash' },
  { name: 'More', component: MoreScreen, icon: 'grid' },
];

/** Stack screens of Fee Management (Accountant workspace and Managers' Fee Management). */
export const accountantStack = [
  ['FeeOverview', FeeHomeScreen],
  ['FeeStudents', withHeader(FeeStudentsScreen, 'Students')],
  ['FeeStudent', FeeStudentScreen],
  ['RecordPayment', RecordPaymentScreen],
  ['Payments', withHeader(PaymentsScreen, 'Payments')],
  ['PaymentDetail', PaymentDetailScreen],
  ['Receipts', withHeader(ReceiptsScreen, 'Receipts')],
  ['Invoices', InvoicesScreen],
  ['InvoiceDetail', InvoiceDetailScreen],
  ['FeeStructures', FeeStructuresScreen],
  ['Discounts', DiscountsScreen],
  ['CashClosing', CashClosingScreen],
  ['FeeReports', FeeReportsScreen],
  ['FeeReport', FeeReportScreen],
];

/** A list screen opened on the stack, with a title and Back. */
function withHeader(Component, title) {
  function Headed(props) {
    return (
      <Screen>
        <ScreenHeader title={title} onBack={() => props.navigation.goBack()} />
        <Component {...props} />
      </Screen>
    );
  }
  Headed.displayName = `Headed(${title})`;
  return Headed;
}
