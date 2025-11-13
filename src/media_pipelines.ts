import { randomUUID } from 'crypto';

export type MediaPipelineType = 'recording' | 'transcription' | 'streaming';

export interface MediaPipelineDestination {
  provider: 'mediaconnect' | 'kinesis' | 's3' | 'custom';
  streamArn?: string;
  flowArn?: string;
  bucket?: string;
  endpoint?: string;
}

export interface ProductionMediaPipeline {
  id: string;
  enabled: boolean;
  type: MediaPipelineType;
  destination: MediaPipelineDestination;
  transcription?: {
    languageCode: string;
    vocabularyName?: string;
    outputBucket?: string;
  };
  recording?: {
    retentionDays: number;
    audioOnly?: boolean;
  };
  tags?: Record<string, string>;
}

export class MediaPipelineRegistry {
  private pipelines: ProductionMediaPipeline[] = [];

  constructor(initialPipelines: ProductionMediaPipeline[] = []) {
    this.pipelines = [...initialPipelines];
  }

  list(): ProductionMediaPipeline[] {
    return [...this.pipelines];
  }

  upsert(pipeline: Omit<ProductionMediaPipeline, 'id'> & { id?: string }): ProductionMediaPipeline {
    const id = pipeline.id ?? randomUUID();
    const existingIndex = this.pipelines.findIndex((p) => p.id === id);
    const payload: ProductionMediaPipeline = { ...pipeline, id } as ProductionMediaPipeline;
    if (existingIndex >= 0) {
      this.pipelines.splice(existingIndex, 1, payload);
    } else {
      this.pipelines.push(payload);
    }
    return payload;
  }

  remove(id: string): boolean {
    const initialLength = this.pipelines.length;
    this.pipelines = this.pipelines.filter((pipeline) => pipeline.id !== id);
    return this.pipelines.length !== initialLength;
  }
}
