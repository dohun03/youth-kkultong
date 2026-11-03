import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PolicyRepository } from './repositories/policy.repository';
import { MetaModule } from '../meta/meta.module';
import { PoliciesController } from './controllers/policies.controller';
import { PoliciesSearchService } from './services/policies-search.service';
import { PoliciesDetailService } from './services/policies-detail.service';
import { SourcePolicyRepository } from './repositories/source-policy.repository';
import { PolicyReviewRepository } from './repositories/policy-review.repository';
import { PolicyReviewsWriteService } from './services/policy-reviews-write.service';
import { PolicyCollectionWriteService } from './services/policy-collection-write.service';
import { PolicyReviewsReadService } from './services/policy-reviews-read.service';
import { MissingPoliciesReadService } from './services/missing-policies-read.service';
import { PolicyReviewApprovalService } from './services/policy-review-approval.service';
import { PolicyReviewRejectionService } from './services/policy-review-rejection.service';

/** 공개 정책 조회와 원본 저장에 필요한 저장소와 서비스를 등록하는 모듈 */
@Module({
  // 메타의 분야 조회와 정책 검색이 서로의 저장소를 사용할 수 있도록 모듈을 연결
  imports: [DatabaseModule, forwardRef(() => MetaModule)],
  controllers: [PoliciesController],
  providers: [
    PolicyRepository, SourcePolicyRepository, PolicyReviewRepository,
    PolicyReviewsWriteService, PolicyCollectionWriteService, PoliciesSearchService, PoliciesDetailService, PolicyReviewsReadService, MissingPoliciesReadService,
    PolicyReviewApprovalService,
    PolicyReviewRejectionService,
  ],
  exports: [
    PolicyRepository, SourcePolicyRepository, PolicyReviewRepository,
    PolicyReviewsWriteService, PolicyCollectionWriteService, PolicyReviewsReadService, MissingPoliciesReadService,
    PolicyReviewApprovalService,
    PolicyReviewRejectionService,
  ],
})
export class PoliciesModule {}
