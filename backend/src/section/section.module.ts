import { Module } from '@nestjs/common';
import { ClassModule } from '../class/class.module';
import { SectionController } from './section.controller';
import { SectionService } from './section.service';

@Module({
  imports: [ClassModule],
  controllers: [SectionController],
  providers: [SectionService],
  exports: [SectionService],
})
export class SectionModule {}
