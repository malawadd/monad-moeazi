import pytest

from moeazi_agent.storage import AnalysisRepository


@pytest.mark.asyncio
async def test_temporal_activities_share_one_bounded_analysis_pool():
    dsn = "postgresql+asyncpg://worker@localhost/moeazi"
    engine = AnalysisRepository.create_worker_engine(dsn)
    try:
        assert engine.pool.size() == 10
        assert engine.pool._max_overflow == 0

        AnalysisRepository.install_worker_engine(dsn, engine)
        assert AnalysisRepository(dsn).engine is engine
        assert AnalysisRepository(dsn).engine is engine
        isolated = AnalysisRepository(f"{dsn}_other")
        assert isolated.engine is not engine
        await isolated.engine.dispose()
    finally:
        AnalysisRepository.release_worker_engine(engine)
        await engine.dispose()


@pytest.mark.asyncio
async def test_releasing_worker_pool_only_clears_its_own_engine():
    dsn = "postgresql+asyncpg://worker@localhost/moeazi"
    engine = AnalysisRepository.create_worker_engine(dsn)
    other_engine = AnalysisRepository.create_worker_engine(dsn)
    try:
        AnalysisRepository.install_worker_engine(dsn, engine)
        AnalysisRepository.release_worker_engine(other_engine)
        assert AnalysisRepository(dsn).engine is engine
    finally:
        AnalysisRepository.release_worker_engine(engine)
        await engine.dispose()
        await other_engine.dispose()
