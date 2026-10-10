#!/usr/bin/env bash
# Seven buckets, each with its own lifecycle in real AWS. All private, always.
set -euo pipefail

for bucket in resumes kyb-documents interview-audio exports audit-archive course-media profile-images; do
  awslocal s3 mb "s3://bharatpath-${bucket}" || true
  awslocal s3api put-public-access-block \
    --bucket "bharatpath-${bucket}" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" || true
done

awslocal sqs create-queue --queue-name bharatpath-default || true
awslocal sqs create-queue --queue-name bharatpath-default-dlq || true

echo "localstack ready: 7 buckets, 2 queues"
