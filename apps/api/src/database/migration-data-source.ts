import { loadEnvironment } from '../common/environment';
import { createDataSource } from './data-source';

// TypeORM CLI에는 DataSource 인스턴스를 하나만 내보낸다.
export default createDataSource(loadEnvironment());
